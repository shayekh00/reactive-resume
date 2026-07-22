import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { lookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";
import { ORPCError } from "@orpc/client";
import { generateText } from "ai";
import { PDFDocument } from "pdf-lib";
import z from "zod";
import { getResumeExportData } from "@reactive-resume/resume/export-sections";
import { generateId, slugify } from "@reactive-resume/utils/string";
import { protectedProcedure } from "../../context";
import { aiRequestRateLimit } from "../../middleware/rate-limit";
import { getModel } from "../ai/service";
import { aiProvidersService } from "../ai-providers/service";
import { resumeService } from "../resume/service";
import { applicationService } from "./service";

const reserved = { tags: ["Applications", "AI"] } as const;
const MAX_JOB_POSTING_BYTES = 200_000;
const MAX_PASTED_JOB_DESCRIPTION_CHARS = 20_000;
const JOB_POSTING_CONTENT_TYPES = ["text/html", "text/plain", "application/xhtml+xml", "application/xml", "text/xml"];
type ValidatedAddress = { address: string; family: 4 | 6 };

// Resolve the user's default (tested + enabled) AI provider into a ready model instance.
async function resolveModel(userId: string) {
	const provider = await aiProvidersService.getDefaultRunnable({ userId });
	if (!provider) {
		throw new ORPCError("BAD_REQUEST", {
			message: "No AI provider is configured. Add one in Settings → Integrations to use AI features.",
		});
	}
	return getModel({
		provider: provider.provider,
		model: provider.model,
		apiKey: provider.apiKey,
		...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
	});
}

// generateText + tolerant JSON extraction + Zod validation. Mirrors the resume-analysis pattern
// (the SDK's generateObject isn't wired for every provider here, so we parse defensively).
async function generateJson<T>(model: Awaited<ReturnType<typeof resolveModel>>, prompt: string, schema: z.ZodType<T>) {
	const { text } = await generateText({ model, messages: [{ role: "user", content: prompt }] });
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
	const candidate = fenced?.[1] ?? text;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start === -1 || end === -1 || end < start) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "The AI response could not be parsed." });
	}
	return schema.parse(JSON.parse(candidate.slice(start, end + 1)));
}

async function generatePlainText(model: Awaited<ReturnType<typeof resolveModel>>, prompt: string) {
	const { text } = await generateText({ model, messages: [{ role: "user", content: prompt }] });
	return text.trim();
}

function isPrivateIPv4(address: string) {
	const parts = address.split(".").map((part) => Number(part));
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
	const [a = 0, b = 0] = parts;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		a >= 224
	);
}

function isPrivateAddress(address: string) {
	if (address.startsWith("::ffff:")) return isPrivateIPv4(address.slice(7));
	if (isIP(address) === 4) return isPrivateIPv4(address);

	const normalized = address.toLowerCase();
	return (
		normalized === "::1" ||
		normalized === "::" ||
		normalized.startsWith("fc") ||
		normalized.startsWith("fd") ||
		normalized.startsWith("fe8") ||
		normalized.startsWith("fe9") ||
		normalized.startsWith("fea") ||
		normalized.startsWith("feb")
	);
}

async function assertPublicHttpUrl(url: string): Promise<{ parsed: URL; address: ValidatedAddress }> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new ORPCError("BAD_REQUEST", { message: "The job posting URL is invalid." });
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new ORPCError("BAD_REQUEST", { message: "Only http(s) job posting URLs are supported." });
	}
	if (parsed.hostname.toLowerCase() === "localhost") {
		throw new ORPCError("BAD_REQUEST", { message: "Local job posting URLs are not supported." });
	}

	const addresses = isIP(parsed.hostname)
		? [{ address: parsed.hostname, family: isIP(parsed.hostname) as 4 | 6 }]
		: ((await lookup(parsed.hostname, { all: true, verbatim: true })) as ValidatedAddress[]);
	if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
		throw new ORPCError("BAD_REQUEST", { message: "Private or local job posting URLs are not supported." });
	}

	const [address] = addresses;
	if (!address) throw new ORPCError("BAD_REQUEST", { message: "The job posting URL could not be resolved." });
	return { parsed, address };
}

function headerValue(headers: IncomingHttpHeaders, name: string) {
	const value = headers[name];
	return Array.isArray(value) ? value[0] : value;
}

async function readTextResponse(response: IncomingMessage) {
	const contentType = headerValue(response.headers, "content-type")?.split(";")[0]?.trim().toLowerCase();
	if (contentType && !JOB_POSTING_CONTENT_TYPES.includes(contentType)) {
		throw new ORPCError("BAD_REQUEST", { message: "The job posting URL did not return a text page." });
	}

	const contentLength = Number(headerValue(response.headers, "content-length"));
	if (Number.isFinite(contentLength) && contentLength > MAX_JOB_POSTING_BYTES) {
		throw new ORPCError("BAD_REQUEST", {
			message: "The job posting page is too large. Paste the description instead.",
		});
	}

	const chunks: Uint8Array[] = [];
	let total = 0;

	for await (const value of response) {
		const chunk = typeof value === "string" ? Buffer.from(value) : value;
		total += chunk.byteLength;
		if (total > MAX_JOB_POSTING_BYTES) {
			response.destroy();
			throw new ORPCError("BAD_REQUEST", {
				message: "The job posting page is too large. Paste the description instead.",
			});
		}
		chunks.push(chunk);
	}

	return new TextDecoder().decode(Buffer.concat(chunks));
}

function requestJobPosting(parsed: URL, address: ValidatedAddress, signal: AbortSignal) {
	return new Promise<IncomingMessage>((resolve, reject) => {
		const client = parsed.protocol === "https:" ? https : http;
		const request = client.request(
			parsed,
			{
				signal,
				headers: {
					"user-agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
					accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
					"accept-language": "en-US,en;q=0.9",
				},
				lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
			},
			resolve,
		);
		request.on("error", reject);
		request.end();
	});
}

// Best-effort fetch + strip of a job posting page. http(s) only, size/time capped.
export async function fetchJobPostingText(url: string): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 10_000);
	try {
		const { parsed, address } = await assertPublicHttpUrl(url);
		const response = await requestJobPosting(parsed, address, controller.signal);
		if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
			throw new ORPCError("BAD_REQUEST", { message: "Redirecting job posting URLs are not supported." });
		}
		if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
			throw new ORPCError("BAD_REQUEST", {
				message: `Couldn't fetch the posting (HTTP ${response.statusCode ?? "unknown"}).`,
			});
		}
		const html = await readTextResponse(response);
		return html
			.replace(/<script[\s\S]*?<\/script>/gi, " ")
			.replace(/<style[\s\S]*?<\/style>/gi, " ")
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 8_000);
	} catch (error) {
		if (error instanceof ORPCError) throw error;
		throw new ORPCError("BAD_REQUEST", { message: "Couldn't read the job posting. Paste the description instead." });
	} finally {
		clearTimeout(timeout);
	}
}

const autofillOutput = z.object({
	company: z.string(),
	role: z.string(),
	location: z.string(),
	salary: z.string(),
	jobDescription: z.string(),
});

export const autofillInputSchema = z.object({
	sourceUrl: z.string().optional(),
	jobDescription: z.string().max(MAX_PASTED_JOB_DESCRIPTION_CHARS).optional(),
});

// Tolerant of LLM variance: clamp the score, cap the lists by slicing rather than rejecting.
const matchScoreOutput = z.object({
	score: z.coerce
		.number()
		.catch(0)
		.transform((n) => Math.max(0, Math.min(100, Math.round(n)))),
	gaps: z
		.array(z.string())
		.catch([])
		.transform((a) => a.slice(0, 8)),
	strengths: z
		.array(z.string())
		.catch([])
		.transform((a) => a.slice(0, 8)),
});

const cappedStringList = (max: number) =>
	z
		.array(z.string())
		.catch([])
		.transform((list) => [...new Set(list.map((entry) => entry.trim()).filter(Boolean))].slice(0, max));

// The ATS-facing keyword report: which posting keywords the resume already covers vs. which are
// genuinely absent. `missing` is surfaced honestly to the user and never written into the resume.
const atsReportOutput = z.object({
	coverageScore: z.coerce
		.number()
		.catch(0)
		.transform((n) => Math.max(0, Math.min(100, Math.round(n)))),
	keywords: cappedStringList(30),
	matched: cappedStringList(30),
	missing: cappedStringList(20),
});

// The faithful tailoring plan. Text edits are keyed to EXISTING resume item ids so the server can
// only rephrase content that already exists — new employers/dates/degrees cannot be invented, and
// skill keywords are merged into (never fabricated onto) items the candidate already listed.
const tailorPlanOutput = z.object({
	summary: z.string().catch(""),
	experience: z.array(z.object({ id: z.string(), description: z.string() })).catch([]),
	skills: z.array(z.object({ id: z.string(), keywords: cappedStringList(15) })).catch([]),
	atsReport: atsReportOutput,
});

export type AtsReport = z.infer<typeof atsReportOutput>;

type TailorPlan = z.infer<typeof tailorPlanOutput>;
type TailorJobContext = { company: string; role: string; jobDescription: string };
// When a rendered attempt overflowed, we feed the page numbers back so the next attempt shortens.
type FitFeedback = { actualPages: number; intendedPages: number };

// The tailoring prompt does the full pipeline in one pass: extract the posting's ATS keywords,
// gap-analyze them against the resume, then rephrase existing content to surface the *matched*
// ones. The hard constraint is faithfulness — the model rewrites, it does not invent. When
// `fitFeedback` is present this is a retry: the previous attempt overflowed and must be shortened.
function buildTailorPrompt(job: TailorJobContext, resume: ResumeData, fitFeedback?: FitFeedback): string {
	const retryPreamble = fitFeedback
		? [
				`RETRY — YOUR PREVIOUS ATTEMPT DID NOT FIT: it rendered to ${fitFeedback.actualPages} page(s) but the resume MUST fit ${fitFeedback.intendedPages} page(s).`,
				"Make the summary and every experience description NOTICEABLY SHORTER this time. Cut filler and low-value words, keep only the strongest keyword-bearing phrasing. Fewer words per bullet. Do not drop bullets entirely.",
				"",
			]
		: [];
	return [
		...retryPreamble,
		"You are optimizing a resume to pass Applicant Tracking Systems (ATS) for a specific job WITHOUT lying.",
		"",
		"Rules — follow strictly:",
		"1. Stay faithful to the resume. Do NOT invent employers, job titles, dates, degrees, or metrics.",
		"2. Do NOT claim skills or keywords the candidate has no evidence for. When a required keyword is absent, list it under atsReport.missing — never add it to the resume text.",
		"3. Rephrase existing bullet points to naturally use the posting's real terminology where the candidate genuinely did that work.",
		"4. For skills, only add a keyword to an existing skill item when the candidate demonstrably has it (e.g. it appears in their experience).",
		"5. Keep the candidate's voice; no overselling or fabricated seniority.",
		"",
		"PRESERVE FORMATTING — the resume is already laid out to fit its pages, so do not break it:",
		"A. Keep each rewritten description the SAME length or SHORTER than the original. Never make it longer — added length pushes content onto extra pages.",
		"B. Preserve the original HTML structure exactly: the same tags and the same number of <li>/<p> elements. Only change the words inside them; do not add or remove bullets, sentences, or paragraphs.",
		"C. Swap keywords in place of weaker wording rather than appending them. Do not stuff keywords.",
		"D. Avoid inserting very long unbreakable words/tokens (e.g. long slash- or hyphen-joined chains) — they create ugly gaps in justified text. Prefer short, common phrasings.",
		"E. Keep the summary to roughly the same length as the original summary.",
		"",
		"Return ONLY JSON with this exact shape:",
		'{ "summary": "<rewritten professional summary as an HTML paragraph, e.g. <p>…</p>>",',
		'  "experience": [{ "id": "<existing experience item id>", "description": "<rewritten HTML description>" }],',
		'  "skills": [{ "id": "<existing skill item id>", "keywords": ["<matched keyword>", …] }],',
		'  "atsReport": { "coverageScore": <0-100 integer: % of important keywords the resume covers>,',
		'    "keywords": ["<important keyword from the posting>", …],',
		'    "matched": ["<keyword the resume already covers>", …],',
		'    "missing": ["<important keyword genuinely absent from the resume>", …] } }',
		"",
		"Only reference ids that exist in the resume below. Omit items you are not changing.",
		"",
		`JOB: ${job.role} at ${job.company}`,
		`JOB DESCRIPTION:\n${job.jobDescription}`,
		"",
		`RESUME (JSON — item ids are the values you must key edits to):\n${JSON.stringify(resume)}`,
	].join("\n");
}

// Guard against layout-breaking rewrites: a tailored string is only accepted when it isn't
// meaningfully longer than the original (10% + a small slack for short items). Longer content is
// what pushes a resume onto an extra page and stretches justified lines, so we keep the original.
function keepShorterOrEqual(original: string, rewrite: string): string {
	const cleaned = rewrite.trim();
	if (!cleaned) return original;
	const budget = Math.max(Math.ceil(original.length * 1.1), original.length + 20);
	return cleaned.length <= budget ? cleaned : original;
}

// Apply the plan by item id: unknown ids are ignored, so the model can only edit content that
// already exists. Skill keywords are merged (deduped) into the candidate's own list.
function applyTailorPlan(resume: ResumeData, plan: TailorPlan): ResumeData {
	const experienceEdits = new Map(plan.experience.map((edit) => [edit.id, edit.description]));
	const skillKeywordEdits = new Map(plan.skills.map((edit) => [edit.id, edit.keywords]));

	return {
		...resume,
		summary: { ...resume.summary, content: keepShorterOrEqual(resume.summary.content, plan.summary) },
		sections: {
			...resume.sections,
			experience: {
				...resume.sections.experience,
				items: resume.sections.experience.items.map((item) => {
					const rewrite = experienceEdits.get(item.id);
					return rewrite ? { ...item, description: keepShorterOrEqual(item.description, rewrite) } : item;
				}),
			},
			skills: {
				...resume.sections.skills,
				items: resume.sections.skills.items.map((item) => {
					const added = skillKeywordEdits.get(item.id);
					if (!added?.length) return item;
					return { ...item, keywords: [...new Set([...item.keywords, ...added])] };
				}),
			},
		},
	};
}

// Name the tailored copy after the candidate + target job, e.g. "Shayekh_Mohiuddin_Ahmed_Navid_Google_Software_Engineer".
// Underscore-joined so it reads well as a downloaded PDF filename; falls back to "Resume" if the resume has no name.
function buildTailoredResumeName(candidateName: string, company: string, role: string): string {
	const toToken = (value: string) =>
		value
			.trim()
			.replace(/[^\p{L}\p{N}]+/gu, "_")
			.replace(/^_+|_+$/g, "");
	return [candidateName || "Resume", company, role].map(toToken).filter(Boolean).join("_");
}

// The resume's intended length: how many pages the layout was designed for.
function intendedPageCount(resume: ResumeData): number {
	return Math.max(1, resume.metadata.layout.pages.length);
}

// Render the resume to a PDF and count physical pages. Content overflow spills past the intended
// pages, so a count above `intendedPageCount` is the overflow signal. Returns null if rendering
// fails so the caller can proceed without blocking on a best-effort check.
async function renderedPageCount(resume: ResumeData): Promise<number | null> {
	try {
		// Imported lazily so the JSX-heavy PDF renderer isn't pulled into this module's static graph
		// (keeps unit tests importing this file without a full PDF toolchain).
		const { createResumePdfFile } = await import("@reactive-resume/pdf/server");
		const file = await createResumePdfFile({ data: getResumeExportData(resume, "resume"), filename: "fit-check.pdf" });
		const pdf = await PDFDocument.load(await file.arrayBuffer());
		return pdf.getPageCount();
	} catch (error) {
		console.error("[Applications AI] Fit-check render failed", error);
		return null;
	}
}

// Max shorten-and-re-render retries after the first attempt. Each retry costs one AI call + one
// render, so this is kept small; the length guard in applyTailorPlan handles the rest.
const MAX_FIT_ATTEMPTS = 2;

export const aiRouter = {
	// Extract structured fields from a pasted job description or a posting URL.
	autofill: protectedProcedure
		.route({ method: "POST", path: "/applications/ai/autofill", operationId: "aiAutofillApplication", ...reserved })
		.input(autofillInputSchema)
		.use(aiRequestRateLimit)
		.output(autofillOutput)
		.handler(async ({ context, input }) => {
			const model = await resolveModel(context.user.id);
			const posting =
				input.jobDescription?.trim() || (input.sourceUrl ? await fetchJobPostingText(input.sourceUrl) : "");
			if (!posting) {
				throw new ORPCError("BAD_REQUEST", { message: "Provide a job posting URL or paste the description." });
			}

			return generateJson(
				model,
				`Extract the following fields from this job posting. Return ONLY JSON with keys company, role, location, salary, jobDescription. Use an empty string for anything not stated. "jobDescription" should be a concise 1–2 paragraph plain-text summary of the responsibilities and requirements.\n\nJOB POSTING:\n${posting}`,
				autofillOutput,
			);
		}),

	// Score the linked resume against the application's job description.
	matchScore: protectedProcedure
		.route({
			method: "POST",
			path: "/applications/{id}/ai/match-score",
			operationId: "aiApplicationMatchScore",
			...reserved,
		})
		.input(z.object({ id: z.string() }))
		.use(aiRequestRateLimit)
		.output(matchScoreOutput)
		.handler(async ({ context, input }) => {
			const application = await applicationService.getById({ id: input.id, userId: context.user.id });
			if (!application.resumeId)
				throw new ORPCError("BAD_REQUEST", { message: "Link a resume to this application first." });
			if (!application.jobDescription) {
				throw new ORPCError("BAD_REQUEST", { message: "Add a job description (via Auto-fill or Edit) first." });
			}

			const [model, resume] = await Promise.all([
				resolveModel(context.user.id),
				resumeService.getById({ id: application.resumeId, userId: context.user.id }),
			]);

			const result = await generateJson(
				model,
				`Compare this resume against the job description. Return ONLY JSON with keys score (integer 0-100 fit), gaps (array of short missing-qualification strings), strengths (array of short matching-strength strings).\n\nRESUME:\n${JSON.stringify(resume.data)}\n\nJOB DESCRIPTION:\n${application.jobDescription}`,
				matchScoreOutput,
			);

			await applicationService.setAiResult({
				id: input.id,
				userId: context.user.id,
				matchScore: result.score,
				aiMetadata: { matchScore: result },
			});

			return result;
		}),

	// Generate a cover letter or recruiter follow-up from the application + resume context.
	draftMessage: protectedProcedure
		.route({
			method: "POST",
			path: "/applications/{id}/ai/draft-message",
			operationId: "aiDraftApplicationMessage",
			...reserved,
		})
		.input(z.object({ id: z.string(), kind: z.enum(["cover-letter", "follow-up"]) }))
		.use(aiRequestRateLimit)
		.output(z.object({ text: z.string() }))
		.handler(async ({ context, input }) => {
			const application = await applicationService.getById({ id: input.id, userId: context.user.id });
			const model = await resolveModel(context.user.id);
			const resume = application.resumeId
				? await resumeService.getById({ id: application.resumeId, userId: context.user.id }).catch(() => null)
				: null;

			const context_ = `ROLE: ${application.role} at ${application.company}${application.location ? ` (${application.location})` : ""}\n${application.jobDescription ? `JOB DESCRIPTION:\n${application.jobDescription}\n` : ""}${resume ? `CANDIDATE RESUME:\n${JSON.stringify(resume.data)}` : ""}`;

			const prompt =
				input.kind === "cover-letter"
					? `Write a concise, specific cover letter (250-350 words, no placeholders like [Name]) for this application, drawing on the resume. Return only the letter text.\n\n${context_}`
					: `Write a short, polite follow-up message (80-120 words) to a recruiter checking in on this application. Warm but not pushy. Return only the message text.\n\n${context_}`;

			return { text: await generatePlainText(model, prompt) };
		}),

	// Create a faithful, ATS-optimized copy of the linked resume tuned to the job description, and
	// link it to the application. The model rephrases existing content and surfaces genuinely-present
	// keywords; it must not fabricate experience or claim skills the candidate lacks.
	tailorResume: protectedProcedure
		.route({
			method: "POST",
			path: "/applications/{id}/ai/tailor-resume",
			operationId: "aiTailorResumeForApplication",
			...reserved,
		})
		.input(z.object({ id: z.string() }))
		.use(aiRequestRateLimit)
		.output(z.object({ resumeId: z.string(), name: z.string(), atsReport: atsReportOutput }))
		.handler(async ({ context, input }) => {
			const application = await applicationService.getById({ id: input.id, userId: context.user.id });
			if (!application.resumeId)
				throw new ORPCError("BAD_REQUEST", { message: "Link a resume to this application first." });
			if (!application.jobDescription) {
				throw new ORPCError("BAD_REQUEST", { message: "Add a job description (via Auto-fill or Edit) first." });
			}

			const [model, resume] = await Promise.all([
				resolveModel(context.user.id),
				resumeService.getById({ id: application.resumeId, userId: context.user.id }),
			]);

			const job = {
				company: application.company,
				role: application.role,
				jobDescription: application.jobDescription,
			};
			const intendedPages = intendedPageCount(resume.data);

			let plan = await generateJson(model, buildTailorPrompt(job, resume.data), tailorPlanOutput);
			let tailoredData = applyTailorPlan(resume.data, plan);

			// Fit feedback loop: render the tailored resume, and while it overflows its intended page
			// count, ask the model to shorten and re-render — capped so cost stays bounded. Best-effort:
			// a failed render (null) ends the loop and the current attempt is used.
			for (let attempt = 0; attempt < MAX_FIT_ATTEMPTS; attempt++) {
				const pages = await renderedPageCount(tailoredData);
				if (pages === null || pages <= intendedPages) break;
				plan = await generateJson(
					model,
					buildTailorPrompt(job, resume.data, { actualPages: pages, intendedPages }),
					tailorPlanOutput,
				);
				tailoredData = applyTailorPlan(resume.data, plan);
			}

			const name = buildTailoredResumeName(resume.data.basics.name, application.company, application.role);

			const newResumeId = await resumeService.create({
				userId: context.user.id,
				name,
				slug: `${slugify(name)}-${generateId().slice(0, 6)}`,
				tags: [...resume.tags, "tailored"],
				data: tailoredData,
				locale: context.locale,
			});

			// Point the application at the tailored copy, persist the ATS report, and log it on the timeline.
			await applicationService.update({ id: input.id, userId: context.user.id, resumeId: newResumeId });
			await applicationService.setAiResult({
				id: input.id,
				userId: context.user.id,
				aiMetadata: { ...(application.aiMetadata ?? {}), tailor: plan.atsReport },
			});
			await applicationService.addNote({
				id: input.id,
				userId: context.user.id,
				text: `AI tailored a resume: ${name} (ATS coverage ${plan.atsReport.coverageScore}%)`,
			});

			return { resumeId: newResumeId, name, atsReport: plan.atsReport };
		}),
};

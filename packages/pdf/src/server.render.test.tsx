import { describe, expect, it } from "vitest";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { createResumePdfFile } from "./server";

describe("createResumePdfFile", () => {
	it("renders a PDF for the sample resume", async () => {
		const file = await createResumePdfFile({ data: sampleResumeData, filename: "resume.pdf" });

		expect(file.size).toBeGreaterThan(0);
	});
});

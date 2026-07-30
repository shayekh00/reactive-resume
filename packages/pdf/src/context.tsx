import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { ReactNode } from "react";
import type { SectionTitleResolver } from "./section-title";
// biome-ignore lint/correctness/noUnusedImports: React must be in scope for the server's classic JSX transform.
import React, { createContext, use, useMemo } from "react";
import { isRTL } from "@reactive-resume/utils/locale";

export type ResumeRenderOptions = {
	includeCoverLetterHeader?: boolean;
};

type RenderContextValue = ResumeData & {
	resolveSectionTitle?: SectionTitleResolver | undefined;
	renderOptions: ResumeRenderOptions;
	rtl: boolean;
};

const RenderContext = createContext<RenderContextValue | null>(null);
const defaultRenderOptions: ResumeRenderOptions = {};

type RenderProviderProps = {
	data: ResumeData;
	resolveSectionTitle?: SectionTitleResolver | undefined;
	renderOptions?: ResumeRenderOptions | undefined;
	children: ReactNode;
};

export const RenderProvider = ({
	data,
	resolveSectionTitle,
	renderOptions = defaultRenderOptions,
	children,
}: RenderProviderProps) => {
	const rtl = isRTL(data.metadata.page.locale);
	const contextValue = useMemo<RenderContextValue>(
		() => ({ ...data, resolveSectionTitle, renderOptions, rtl }),
		[data, resolveSectionTitle, renderOptions, rtl],
	);

	return <RenderContext.Provider value={contextValue}>{children}</RenderContext.Provider>;
};

export const useRender = (): RenderContextValue => {
	const context = use(RenderContext);

	if (!context) throw new Error("useRender must be called inside a <RenderProvider>.");

	return context;
};

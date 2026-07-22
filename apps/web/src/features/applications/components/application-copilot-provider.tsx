import { t } from "@lingui/core/macro";
import { useMutation } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo } from "react";
import { toast } from "sonner";
import { orpc } from "@/libs/orpc/client";

// Long-running AI actions (currently resume tailoring) live here rather than inside the detail
// sheet so they survive the sheet unmounting: the user can close the panel and keep working while
// generation runs, and the completion toast still fires because this provider stays mounted on the
// applications route. Progress is exposed by application id so any re-rendered copilot can reflect it.
type ApplicationCopilotContextValue = {
	tailoringApplicationId: string | null;
	tailorResume: (applicationId: string) => void;
};

type TailorToastContext = { toastId: string | number };

const ApplicationCopilotContext = createContext<ApplicationCopilotContextValue | null>(null);

export function ApplicationCopilotProvider({ children }: { children: React.ReactNode }) {
	const tailor = useMutation(
		orpc.applications.ai.tailorResume.mutationOptions({
			onMutate: (): TailorToastContext => ({
				toastId: toast.loading(t`Tailoring your resume… you can keep working while this runs.`),
			}),
			onSuccess: (result, _variables, context) => {
				toast.success(t`Tailored "${result.name}" — ${result.atsReport.coverageScore}% ATS keyword coverage.`, {
					id: (context as TailorToastContext | undefined)?.toastId,
				});
			},
			onError: (error, _variables, context) => {
				toast.error(error.message || t`Tailoring failed.`, {
					id: (context as TailorToastContext | undefined)?.toastId,
				});
			},
		}),
	);

	const tailorResume = useCallback((applicationId: string) => tailor.mutate({ id: applicationId }), [tailor]);

	const value = useMemo<ApplicationCopilotContextValue>(
		() => ({
			// `tailor.variables` holds the in-flight input while pending, so status is derived, not tracked separately.
			tailoringApplicationId: tailor.isPending ? (tailor.variables?.id ?? null) : null,
			tailorResume,
		}),
		[tailor.isPending, tailor.variables?.id, tailorResume],
	);

	return <ApplicationCopilotContext.Provider value={value}>{children}</ApplicationCopilotContext.Provider>;
}

export function useApplicationCopilot(): ApplicationCopilotContextValue {
	const context = useContext(ApplicationCopilotContext);
	if (!context) {
		throw new Error("useApplicationCopilot must be used within an ApplicationCopilotProvider");
	}
	return context;
}

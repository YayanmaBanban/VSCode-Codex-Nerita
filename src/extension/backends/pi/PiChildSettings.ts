// 子固有の文脈を付け足し、承認先とツール権限は親の上限を保持する。
import type { PiRuntimeOptions } from "./PiRuntime";
import type { PiChildOptions } from "./PiChildRuntimes";
import type { ToolAuthorizer } from "../../security/ApprovalGuard";

/** Host の承認関数を包むだけにし、子に別の承認先を指定させない。 */
export function childSettings(
	parent: PiRuntimeOptions,
	options: PiChildOptions,
): Partial<PiRuntimeOptions> {
	const result: Partial<PiRuntimeOptions> = {};
	if (options.allowedTools) {
		result.allowedTools = options.allowedTools.filter(
			(tool) =>
				!parent.allowedTools || parent.allowedTools.includes(tool),
		);
	}
	if (options.systemPrompt !== undefined) {
		result.subagentPrompt = options.systemPrompt;
		result.subagentPromptMode = options.systemPromptMode ?? "append";
	}
	if (options.preferredModel) {
		result.preferredModel = { ...options.preferredModel };
		result.strictModel = true;
	}
	const context = options.approvalContext;
	const authorize = parent.authorize;
	if (context && authorize) {
		result.authorize = subagentAuthorizer(authorize, context);
	}
	return result;
}

/** 同名の並列の子もタスクを常時表示して承認先を区別する。 */
export function subagentAuthorizer(
	authorize: ToolAuthorizer,
	{ agent, task }: { agent: string; task: string },
): ToolAuthorizer {
	return (presentation, signal) =>
		authorize(
			{
				...presentation,
				fields: [
					...(presentation.fields ?? []),
					{
						id: "subagent",
						label: "サブエージェント",
						value: agent,
						display: "text",
					},
					{
						id: "subagent-task",
						label: "子のタスク",
						value: task,
						display: "text",
					},
				],
			},
			signal,
		);
}

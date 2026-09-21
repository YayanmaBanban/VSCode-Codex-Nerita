// SDKの副作用ツールを包み、承認と取消を確認してから実処理へ渡す。
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

/** 実行ごとの入力をHostで確認し、許可された場合だけ戻る。 */
export type PiAuthorize = (
	title: string,
	signal?: AbortSignal,
) => Promise<AbortSignal>;

/** 承認後にも取消を確認し、許可とStopが競合した場合の実行を防ぐ。 */
export function approvePiTool(
	tool: Omit<ToolDefinition, "renderCall" | "renderResult">,
	cwd: string,
	authorize: PiAuthorize,
): ToolDefinition {
	return {
		...tool,
		executionMode: "sequential",
		async execute(id, params, signal, update, context) {
			signal?.throwIfAborted();
			const approvalSignal = await authorize(
				`Pi: ${tool.name} の実行承認\n作業フォルダー: ${cwd}\n${JSON.stringify(params, null, 2)}`,
				signal,
			);
			approvalSignal.throwIfAborted();
			signal?.throwIfAborted();
			return tool.execute(id, params, signal, update, context);
		},
	};
}

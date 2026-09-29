// 継続した子のイベントも現在のステップへ記録し、取消しを SDK に伝える。
import type { PiRuntimeSession } from "../PiRuntime";
import type { PiAgentViews } from "../PiAgentViews";

/** 取消しと prompt 終了の競合でも購読を残さず、ツール失敗を成功として返さない。 */
export async function promptWorkflowChild(
	child: PiRuntimeSession,
	task: string,
	signal: AbortSignal,
	views: PiAgentViews,
	id: string,
) {
	let output = "";
	let failed = false;
	const stop = () => {
		void child.abort().catch(() => undefined);
	};
	const unsubscribe = child.subscribe((event) => {
		views.event(id, event);
		if (event.type === "tool_execution_end" && event.isError) {
			failed = true;
		}
		if (
			event.type === "message_end" &&
			event.message.role === "assistant"
		) {
			output = event.message.content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("\n")
				.slice(0, 32768);
			failed ||= ["error", "aborted"].includes(event.message.stopReason);
		}
	});
	signal.addEventListener("abort", stop, { once: true });
	try {
		signal.throwIfAborted();
		await child.prompt(task, { expandPromptTemplates: false });
		signal.throwIfAborted();
		if (failed) {
			throw new Error(output || "子の実行が失敗しました。");
		}
		return output;
	} finally {
		unsubscribe();
		signal.removeEventListener("abort", stop);
	}
}

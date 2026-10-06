// 継続した子のイベントも現在のステップへ記録し、取消しを SDK に伝える。
import { nonEmptyString } from "@nerita/shared/valuePredicates";
import { PiChildOutput } from "../PiChildOutput";
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
	const outcome = new PiChildOutput(views, id);
	const stop = () => {
		void child.abort().catch(() => undefined);
	};
	const unsubscribe = child.subscribe((event) => outcome.receive(event));
	signal.addEventListener("abort", stop, { once: true });
	try {
		signal.throwIfAborted();
		await child.prompt(task, { expandPromptTemplates: false });
		signal.throwIfAborted();
		if (outcome.failed) {
			throw new Error(
				nonEmptyString(outcome.output) ?? "子の実行が失敗しました。",
			);
		}
		return outcome.output;
	} finally {
		unsubscribe();
		signal.removeEventListener("abort", stop);
	}
}

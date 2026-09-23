// Plan完了後の実装先を選ぶカードを表示する。
import { useReducedMotion } from "motion/react";
import type { ChatState } from "../../shared/chatState";
import type { UiMessage } from "../../shared/messages";
import { BorderBeam } from "../ui/BorderBeam";

/** 完了したPlanに対する一回限りの選択をHostへ送る。 */
export function PlanDecisionCard({
	state,
	send,
}: {
	state: ChatState;
	send: (message: UiMessage) => void;
}) {
	const reduced = useReducedMotion();
	const decision = state.planDecision;
	if (!decision || !state.sessionId || state.connection !== "ready") {
		return null;
	}
	const disabled =
		state.run === "running" ||
		state.run === "cancelling" ||
		state.sessionPending ||
		state.configPending;
	const choose = (action: "current" | "new" | "continue") =>
		send({
			type: "plan/decide",
			requestId: crypto.randomUUID(),
			sessionId: state.sessionId!,
			runId: decision.runId,
			action,
		});
	return (
		<section
			aria-label="Planの実装"
			className="relative my-4 overflow-hidden rounded-lg border border-solid border-[var(--vscode-testing-iconPassed,#73c991)] p-4"
		>
			{!reduced && (
				<BorderBeam
					size={80}
					duration={6}
					colorFrom="#45d483"
					colorTo="#a2f2ae"
					beamBorderRadius={8}
				/>
			)}
			<h2 className="mb-3 text-[13px] font-semibold">
				このプランを実装しますか？
			</h2>
			<div className="flex flex-wrap gap-2">
				<button
					disabled={disabled}
					onClick={() => choose("current")}
					className="primary border-transparent bg-primary text-primary-text"
				>
					このセッションで実装する
				</button>
				<button
					disabled={disabled}
					onClick={() => choose("new")}
					className="quiet bg-transparent"
				>
					新規セッションで実装する
				</button>
				<button
					disabled={disabled}
					onClick={() => choose("continue")}
					className="quiet bg-transparent"
				>
					プランを続ける
				</button>
			</div>
		</section>
	);
}

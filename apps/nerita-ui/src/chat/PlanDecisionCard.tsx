// `Plan` 完了後の実装先を選ぶカードを表示する。
import { cn } from "cnfast";
import { useReducedMotion } from "motion/react";
import type { ChatState } from "@nerita/shared/chatState";
import type { UiMessage } from "@nerita/shared/messages";
import { BorderBeam } from "../ui/BorderBeam";
import { ButtonCurtain } from "../ui/ButtonCurtain";

/** 完了した `Plan` に対する1回限りの選択を Host へ送る。 */
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
			className={cn(
				"relative my-4 overflow-hidden rounded-lg border border-solid",
				"border-[var(--nerita-testing-icon-passed)] p-4",
			)}
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
					className="quiet group relative isolate overflow-hidden bg-transparent"
				>
					新規セッションで実装する
					<ButtonCurtain
						name="新規セッションで実装する"
						className="bg-green-300"
					/>
				</button>
				<button
					disabled={disabled}
					onClick={() => choose("continue")}
					className="quiet group relative isolate overflow-hidden bg-transparent"
				>
					プランを続ける
					<ButtonCurtain
						name="プランを続ける"
						className="bg-green-300"
					/>
				</button>
			</div>
		</section>
	);
}

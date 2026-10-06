// ツールごとの折り畳みカードと、エージェント由来の承認選択肢を表示する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";

import { type AsyncTask, taskActive } from "@nerita/shared/asyncTask";
import type { ChatState } from "@nerita/shared/chatState";
import type { UiMessage } from "@nerita/shared/messages";
import { cn } from "cnfast";
import { useReducedMotion } from "motion/react";
import { BorderBeam } from "../ui/BorderBeam";
import { ButtonCurtain } from "../ui/ButtonCurtain";
import { PermissionContent } from "./PermissionContent";
import { ToolCard } from "./tools/ToolCard";

/** ツール・承認の表示に使うチャット状態と、操作要求の送信関数。 */
type ActivityProps = { state: ChatState; send: (message: UiMessage) => void };

/** 現在の実行の作業状況と承認操作を表示する。 */
export function Activity({ state, send }: ActivityProps) {
	const reduced = useReducedMotion();
	return (
		<>
			{state.tools.length > 0 && (
				<ToolActivity state={state} send={send} />
			)}
			{state.permissions.map((permission) => (
				<section
					className={cn(
						"permission-card relative my-[16px] rounded-[8px] border border-solid",
						"border-alert-border p-[16px]",
					)}
					aria-label="承認要求"
					key={permission.id}
				>
					{!(reduced === true) && (
						<span
							aria-hidden="true"
							className="pointer-events-none absolute inset-0 rounded-[inherit]"
						>
							<BorderBeam
								size={80}
								duration={6}
								colorFrom="var(--nerita-focus-border)"
								colorTo="var(--nerita-editor-warning-foreground)"
								beamBorderRadius={8}
							/>
						</span>
					)}
					<PermissionContent permission={permission} />
					<div className="permission-actions flex flex-wrap gap-[8px]">
						{permission.options.map((option) => (
							<button
								key={option.id}
								type="button"
								className={cn(
									option.kind === "allow"
										? "primary border-transparent bg-primary text-primary-text"
										: "quiet group relative isolate overflow-hidden bg-transparent",
								)}
								onClick={() => {
									if (
										isNonEmptyString(state.sessionId) &&
										isNonEmptyString(state.runId)
									) {
										send({
											type: "permission/respond",
											requestId: crypto.randomUUID(),
											sessionId: state.sessionId,
											runId: state.runId,
											permissionId: permission.id,
											optionId: option.id,
										});
									}
								}}
							>
								{option.name}
								{option.kind !== "allow" && (
									<ButtonCurtain
										name={option.name}
										className={
											option.kind === "deny"
												? "bg-red-300"
												: "bg-yellow-300"
										}
									/>
								)}
							</button>
						))}
					</div>
				</section>
			))}
		</>
	);
}

/** ツールと非同期タスクの表示に使う状態と、停止要求の送信関数。 */
type ToolActivityProps = ActivityProps;

/** 実行中ツールと停止可能な非同期タスクを対応付ける。 */
function ToolActivity({ state, send }: ToolActivityProps) {
	return (
		<section aria-label="ツール実行">
			{state.tools.map((tool) => {
				const task = state.asyncTasks.find(
					(item) => item.toolCallId === tool.id,
				);
				const cancelTurn =
					!task &&
					tool.runId === state.runId &&
					state.run === "running";
				return (
					<ToolCard
						key={`${tool.runId ?? ""}:${tool.id}`}
						tool={tool}
						send={send}
						cwd={state.cwd}
						task={task}
						cancelTurn={cancelTurn}
						onStop={
							(cancelTurn || canStopTask(task) === true) &&
							isNonEmptyString(state.sessionId) &&
							(isNonEmptyString(tool.runId) ||
								isNonEmptyString(state.runId)) &&
							state.connection === "ready"
								? () =>
										send({
											type: "execution/stop",
											toolId: tool.id,
											requestId: crypto.randomUUID(),
											sessionId: state.sessionId!,
											runId: (tool.runId ?? state.runId)!,
										})
								: undefined
						}
					/>
				);
			})}
		</section>
	);
}

/** 停止可能で未処理の非同期タスクだけを対象にする。 */
function canStopTask(task: AsyncTask | undefined) {
	return (
		task && taskActive(task) && task.canStop && !(task.stopPending === true)
	);
}

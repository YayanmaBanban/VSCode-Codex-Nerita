// ツールごとの折り畳みカードと、エージェント由来の承認選択肢を表示する。
import { useReducedMotion } from "motion/react";
import { BorderBeam } from "../ui/BorderBeam";
import type { ChatState } from "../../shared/chatState";
import type { UiMessage } from "../../shared/messages";
import { ToolCard } from "./tools/ToolCard";
import { PermissionContent } from "./PermissionContent";
import { type AsyncTask, taskActive } from "../../shared/asyncTask";

/** 現在の実行の作業状況と承認操作を表示する。 */
export function Activity({
	state,
	send,
}: {
	state: ChatState;
	send: (message: UiMessage) => void;
}) {
	const reduced = useReducedMotion();
	return (
		<>
			{state.tools.length > 0 && (
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
									(cancelTurn || canStopTask(task)) &&
									state.sessionId &&
									(tool.runId || state.runId) &&
									state.connection === "ready"
										? () =>
												send({
													type: "execution/stop",
													toolId: tool.id,
													requestId:
														crypto.randomUUID(),
													sessionId: state.sessionId!,
													runId: (tool.runId ??
														state.runId)!,
												})
										: undefined
								}
							/>
						);
					})}
				</section>
			)}
			{state.permissions.map((permission) => (
				<section
					className="permission-card relative my-[16px] rounded-[8px] border border-solid border-alert-border p-[16px]"
					aria-label="承認要求"
					key={permission.id}
				>
					{!reduced && (
						<span
							aria-hidden="true"
							className="pointer-events-none absolute inset-0 rounded-[inherit]"
						>
							<BorderBeam
								size={80}
								duration={6}
								colorFrom="var(--vscode-focusBorder, #6dadc9)"
								colorTo="var(--vscode-editorWarning-foreground, #deb86d)"
								beamBorderRadius={8}
							/>
						</span>
					)}
					<span className="eyebrow text-[12px] tracking-[0.13em] text-muted">
						確認が必要です
					</span>
					<PermissionContent permission={permission} />
					<div className="permission-actions flex flex-wrap gap-[8px]">
						{permission.options.map((option) => (
							<button
								key={option.id}
								className={
									option.kind.startsWith("allow")
										? "primary border-transparent bg-primary text-primary-text"
										: "quiet bg-transparent"
								}
								onClick={() => {
									if (state.sessionId && state.runId) {
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
							</button>
						))}
					</div>
				</section>
			))}
		</>
	);
}

/** 停止可能で未処理の非同期タスクだけを対象にする。 */
function canStopTask(task: AsyncTask | undefined) {
	return task && taskActive(task) && task.canStop && !task.stopPending;
}

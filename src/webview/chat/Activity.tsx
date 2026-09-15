// ツールごとの折り畳みカードと、エージェント由来の承認選択肢を表示する。
import type { ChatState, UiMessage } from "../../shared/messages";
import { ToolCard } from "./tools/ToolCard";
import { toolTerminalId } from "../../shared/toolTerminal";
/** 現在の実行の作業状況と承認操作を表示する。 */
export function Activity({
	state,
	send,
}: {
	state: ChatState;
	send: (message: UiMessage) => void;
}) {
	return (
		<>
			{state.tools.length > 0 && (
				<section aria-label="ツール実行">
					{state.tools.map((tool) => {
						const terminalId = toolTerminalId(tool);
						return (
							<ToolCard
								key={`${tool.runId ?? ""}:${tool.id}`}
								tool={tool}
								onStop={
									terminalId &&
									tool.terminal?.canStop &&
									state.sessionId &&
									tool.runId &&
									state.connection === "ready"
										? () =>
												send({
													type: "terminal/kill",
													terminalId,
													toolId: tool.id,
													requestId:
														crypto.randomUUID(),
													sessionId: state.sessionId!,
													runId: tool.runId!,
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
					className="permission-card"
					aria-label="承認要求"
					key={permission.id}
				>
					<span className="eyebrow">確認が必要です</span>
					<h2>{permission.title}</h2>
					<div className="permission-actions">
						{permission.options.map((option) => (
							<button
								key={option.id}
								className={
									option.kind.startsWith("allow")
										? "primary"
										: "quiet"
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

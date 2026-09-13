// ツール概要とエージェント由来の承認選択肢を安全なテキストで表示する。
import type { ChatState, UiMessage } from "../../shared/messages";
const toolLabels = {
	pending: "待機中",
	in_progress: "実行中",
	completed: "完了",
	failed: "失敗",
};
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
				<section className="activity" aria-label="作業状況">
					<h2>作業状況</h2>
					{state.tools.map((tool) => (
						<div className="tool" key={tool.id}>
							<div>
								<span>{tool.title}</span>
								<span className="muted">
									{toolLabels[tool.status]}
								</span>
							</div>
							{tool.paths.map((path) => (
								<code key={path}>{path}</code>
							))}
						</div>
					))}
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

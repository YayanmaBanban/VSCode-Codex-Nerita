// 接続状態・認証・再接続の操作をまとめて表示する。
import type { ChatState, UiMessage } from "../../shared/messages";
const connectionLabels = {
	disconnected: "未接続",
	connecting: "接続中",
	ready: "接続済み",
	"auth-required": "認証が必要",
	authenticating: "ログイン待ち",
	error: "接続エラー",
};

/** 接続と認証の状態に応じた操作だけを提示する。 */
export function ConnectionHeader({
	state,
	requestError,
	available,
	send,
}: {
	state: ChatState;
	requestError: string | null;
	available: boolean;
	send: (message: UiMessage) => void;
}) {
	const reconnectable = ["disconnected", "error", "auth-required"].includes(
		state.connection,
	);
	return (
		<>
			{" "}
			<header className="chat-header">
				<div>
					<span className="eyebrow">WORKSPACE ASSISTANT</span>
					<h1>
						Codex <span>ACP</span>
					</h1>
				</div>
				<button
					className="quiet"
					disabled={!available}
					onClick={() =>
						send({
							type: "session/new",
							requestId: crypto.randomUUID(),
						})
					}
				>
					＋ 新規会話
				</button>
			</header>
			<div className="connection-bar">
				<span className={`status-dot ${state.connection}`} />
				<span role="status">{connectionLabels[state.connection]}</span>
				{reconnectable && (
					<button
						className="link-button"
						onClick={() =>
							send({
								type: "connection/retry",
								requestId: crypto.randomUUID(),
							})
						}
					>
						{state.connection === "disconnected"
							? "接続する"
							: "再接続"}
					</button>
				)}
			</div>
			{(state.error || requestError) && (
				<div role="alert" className="error-banner">
					{requestError || state.error}
				</div>
			)}
			{state.connection === "auth-required" && (
				<section className="auth-card" aria-label="認証">
					<p>
						ChatGPTにログインするか、VS
						Codeの起動環境に設定したAPIキーを使用します。
					</p>
					{state.authMethods.map((method) => (
						<button
							key={method.id}
							onClick={() =>
								send({
									type: "auth/start",
									requestId: crypto.randomUUID(),
									methodId: method.id,
								})
							}
						>
							{method.id === "chat-gpt"
								? "ChatGPTでログイン"
								: "環境変数のAPIキーを使用"}
						</button>
					))}
				</section>
			)}
			{state.connection === "authenticating" && (
				<p className="auth-card">
					ブラウザでログインを完了してください。最大3分間待機します。
				</p>
			)}
		</>
	);
}

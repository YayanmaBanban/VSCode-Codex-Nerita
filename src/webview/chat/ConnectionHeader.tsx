// 接続状態・認証・再接続の操作をまとめて表示する。
import type { ChatState, UiMessage } from "../../shared/messages";

/** 認証案内とエラー通知に共通する枠・色・余白。 */
const noticeClass =
	"mx-[14px] mt-[12px] mb-0 rounded-[6px] border border-solid border-alert-border bg-alert p-[12px] leading-[1.7]";
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
			<header className="chat-header flex items-center justify-between gap-[12px] px-[20px] pt-[22px] pb-[17px] [@media(max-width:360px)]:px-[14px]">
				<div>
					<span className="eyebrow text-[9px] tracking-[0.13em] text-muted">
						WORKSPACE ASSISTANT
					</span>
					<h1>
						Codex <span>ACP</span>
					</h1>
				</div>
				<button
					className="quiet bg-transparent"
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
			<div className="connection-bar flex min-h-[38px] items-center gap-[7px] border-0 border-y border-solid border-message-border px-[20px] py-[8px] text-[11px] text-muted">
				<span
					className={`status-dot ${state.connection} size-[6px] rounded-full ${state.connection === "ready" ? "bg-[#75bba0]" : state.connection === "error" || state.connection === "auth-required" ? "bg-[#deb86d]" : "bg-[#8a929c]"}`}
				/>
				<span role="status">{connectionLabels[state.connection]}</span>
				{reconnectable && (
					<button
						className="link-button ml-auto border-0 bg-transparent p-[2px] text-link"
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
				<div role="alert" className={`error-banner ${noticeClass}`}>
					{requestError || state.error}
				</div>
			)}
			{state.connection === "auth-required" && (
				<section
					className={`auth-card ${noticeClass}`}
					aria-label="認証"
				>
					<p>
						ChatGPTにログインするか、VS
						Codeの起動環境に設定したAPIキーを使用します。
					</p>
					{state.authMethods.map((method) => (
						<button
							key={method.id}
							className="m-[3px]"
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
				<p className={`auth-card ${noticeClass}`}>
					ブラウザでログインを完了してください。最大3分間待機します。
				</p>
			)}
		</>
	);
}

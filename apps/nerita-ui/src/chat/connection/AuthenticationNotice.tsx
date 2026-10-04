// 未認証時と認証待ちの案内・操作を共通の配置で表示する。

import type { ChatState } from "@nerita/shared/chatState";
import type { UiMessage } from "@nerita/shared/messages";
import { ActionNotice } from "../../ui/ActionNotice";

/** 認証状態と、認証要求の送信関数。 */
type AuthenticationNoticeProps = {
	state: ChatState;
	send: (message: UiMessage) => void;
};

/** 認証状態に応じて説明と右上の操作ボタンを切り替える。 */
export function AuthenticationNotice({
	state,
	send,
}: AuthenticationNoticeProps) {
	const authenticating = state.connection === "authenticating";
	let actions = state.authMethods;
	let description =
		state.piAccount !== null
			? "Piの認証情報を設定してください。"
			: "ChatGPTにログインするか、VSCodeの起動環境に設定したAPIキーを使用します。";
	if (authenticating) {
		actions =
			state.piAccount !== null
				? [{ id: "pi-cancel", name: "認証をキャンセル" }]
				: [];
		description =
			state.piAccount !== null
				? "エディターの「Pi 認証情報」で設定してください。画面を閉じるとチャットへ戻れます。"
				: "ブラウザでログインを完了してください。最大3分間待機します。";
	}

	return (
		<ActionNotice
			label="認証"
			className="auth-card"
			title={authenticating ? "認証を待っています" : "認証が必要です"}
			description={description}
			actions={actions.map((method) => ({
				...method,
				onClick: () =>
					send({
						type: "auth/start",
						requestId: crypto.randomUUID(),
						methodId: method.id,
					}),
			}))}
		/>
	);
}

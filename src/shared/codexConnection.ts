// 実機とプレビューで共有する、Codex の接続・認証の表示文言と操作 ID。
export const codexConnectionText = {
	authenticationFailed:
		"ログインできませんでした。認証方法と環境変数を確認して再試行してください。",
	disconnected: "Codexとの接続が終了しました。再接続してください。",
	chatgpt: "ChatGPTでログイン",
	apiKey: "環境変数のAPIキーを使用",
} as const;

/** 状態間で配列や要素を共有せず、同じ認証方法を生成する。 */
export function codexAuthMethods() {
	return [
		{ id: "chatgpt", name: codexConnectionText.chatgpt },
		{ id: "apiKey", name: codexConnectionText.apiKey },
	];
}

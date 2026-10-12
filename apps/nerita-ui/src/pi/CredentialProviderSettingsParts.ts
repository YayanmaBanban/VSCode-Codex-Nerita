// 表示用の型と文書変換を共有し、各入力欄では状態を複製しない。

import { type CredentialReply } from "@nerita/shared/credentials";

import "../chat/chat.css";
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type State = Extract<CredentialReply, { type: "state" }>;
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export function providerStatus(provider: State["providers"][number]) {
	const status = provider.available ? "利用可能" : "未導入";
	if (provider.id !== "bitwarden-secrets-manager") {
		return status;
	}
	const modes = {
		session: "このセッションのみ",
		"secret-storage": "VS Code に保存",
	};
	return `${status} · ${provider.authenticated ? "認証済み" : "未認証"} · ${provider.mode !== null ? modes[provider.mode] : "未設定"}`;
}
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export function providerName(id: string) {
	const names: Record<string, string> = {
		git: "Git",
		npmrc: "npm 設定",
		"bitwarden-secrets-manager": "Bitwarden Secrets Manager",
	};
	return names[id] ?? id;
}

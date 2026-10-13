// 資格情報の取得元の状態を、管理画面の表示名と説明へ変換する。

import { type CredentialReply } from "@nerita/shared/credentials";

import "../chat/chat.css";
/** Host から届く資格情報管理の状態通知。秘密値は含まない。 */
export type State = Extract<CredentialReply, { type: "state" }>;
/** 取得元の利用可否を表示し、Bitwarden には認証状態と保存方法も添える。 */
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
/** 既知の取得元は表示名へ変換し、未知の ID はそのまま表示する。 */
export function providerName(id: string) {
	const names: Record<string, string> = {
		git: "Git",
		npmrc: "npm 設定",
		"bitwarden-secrets-manager": "Bitwarden Secrets Manager",
	};
	return names[id] ?? id;
}

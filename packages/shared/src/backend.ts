// バックエンド選択の識別子を Host と Webview で共有する。
export type BackendId = "codex" | "pi";

/** 設定や通信に含まれる選択値を限定する。 */
export function isBackendId(value: unknown): value is BackendId {
	return value === "codex" || value === "pi";
}

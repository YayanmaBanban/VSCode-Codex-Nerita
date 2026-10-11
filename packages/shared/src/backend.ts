// バックエンドの識別子と Nerita Trust の判定規則を Host と Webview で共有する。
export type BackendId = "codex" | "pi";

/** 設定や通信に含まれる選択値を限定する。 */
export function isBackendId(value: unknown): value is BackendId {
	return value === "codex" || value === "pi";
}

/** Codex は自身の実行許可を使い、Pi だけが Nerita Trust を照合する。 */
export function backendWorkspaceTrusted<T extends boolean | Promise<boolean>>(
	backend: BackendId,
	checkTrust: () => T,
): true | T {
	return backend === "codex" || checkTrust();
}

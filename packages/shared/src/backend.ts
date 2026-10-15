// 設定と通信で使うバックエンドの識別子を共有する。
export type BackendId = "codex" | "pi";

/** 設定や通信に含まれる選択値を限定する。 */
export function isBackendId(value: unknown): value is BackendId {
	return value === "codex" || value === "pi";
}

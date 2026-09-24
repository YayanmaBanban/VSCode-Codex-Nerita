// 両バックエンドで選択できるWindows Sandbox実装と通信値の検証を定義する。
export type WindowsSandboxImplementation = "elevated" | "unelevated";

/** HostとWebviewの双方で未知の実装名を拒否する。 */
export function isWindowsSandboxImplementation(
	value: unknown,
): value is WindowsSandboxImplementation {
	return value === "elevated" || value === "unelevated";
}

// サイドバー配置の通信で共有する値と検証を定義する。
/** チャットを配置するサイドバー。 */
export type SidebarLocation = "primary" | "secondary";
/** 設定値と受信値を二つの配置先に限定する。 */
export function isSidebarLocation(value: unknown): value is SidebarLocation {
	return value === "primary" || value === "secondary";
}

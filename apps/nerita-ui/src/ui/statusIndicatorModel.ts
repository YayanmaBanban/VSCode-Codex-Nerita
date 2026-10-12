// 機能固有の状態を共通アイコンの表示上の意味へ対応付ける。
/** 読み上げる状態名と詳細説明は利用側で付ける。 */
export type StatusIndicatorState =
	"idle" | "running" | "completed" | "warning" | "error";

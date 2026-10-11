// 機能固有の状態名を受け取らず、進行・完了・注意・エラー・待機を共通のアイコンで表示する。
import { cn } from "cnfast";
import { Check, LoaderCircle, X } from "lucide-react";
import "./status-indicator.css";

/** 各機能の状態を、表示上の意味に対応付ける。 */
export type StatusIndicatorState =
	"idle" | "running" | "completed" | "warning" | "error";

/** 状態名の読み上げと説明は呼び出し元に任せ、待機と注意は同じパルスを使う。 */
export function StatusIndicator({ status }: { status: StatusIndicatorState }) {
	if (status === "running") {
		return (
			<LoaderCircle
				size={16}
				aria-hidden="true"
				className="status-indicator-running shrink-0"
			/>
		);
	}
	if (status === "completed") {
		return (
			<Check
				size={16}
				aria-hidden="true"
				className="shrink-0 text-menu-check"
			/>
		);
	}
	if (status === "error") {
		return (
			<X
				size={16}
				aria-hidden="true"
				className="shrink-0 text-tool-error"
			/>
		);
	}
	return (
		<span
			aria-hidden="true"
			className={cn(
				"status-indicator-dots flex h-4 w-4 shrink-0 items-center justify-between",
				status === "warning" ? "text-warning" : "text-foreground",
			)}
		>
			<span className="size-1 rounded-full bg-current" />
			<span className="size-1 rounded-full bg-current" />
			<span className="size-1 rounded-full bg-current" />
		</span>
	);
}

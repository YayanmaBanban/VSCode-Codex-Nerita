// 履歴パネルの閉じる操作と作業フォルダ・取得状態を表示する。
import type { RefObject } from "react";
import { LoaderCircle, X } from "lucide-react";
import type { ChatState } from "../../../shared/chatState";
import { sessionActionClass as actionClass } from "./SessionItem";

/** 開いた直後のフォーカス先を親へ公開し、一覧更新では移動させない。 */
export function SessionPanelHeader({
	state,
	close,
	onClose,
}: {
	state: Pick<ChatState, "cwd" | "sessionsLoading">;
	close: RefObject<HTMLButtonElement | null>;
	onClose: () => void;
}) {
	return (
		<header className="border-0 border-b border-solid border-panel-border px-[16px] py-[14px]">
			<div className="flex items-center justify-between gap-[8px]">
				<h2 className="m-0 text-[13px] font-semibold">
					セッション一覧
				</h2>
				<button
					ref={close}
					type="button"
					className={actionClass}
					aria-label="セッション一覧を閉じる"
					title="閉じる"
					onClick={onClose}
				>
					<X size={16} aria-hidden="true" />
				</button>
			</div>
			<div className="mt-[8px] flex items-start gap-[8px]">
				<span
					className="min-w-0 flex-1 break-all font-editor text-[12px] leading-[1.6] text-muted"
					title={state.cwd ?? undefined}
				>
					{state.cwd ?? "ワークスペース未接続"}
				</span>
				{state.sessionsLoading && (
					<span
						role="progressbar"
						aria-label="セッション一覧を取得中"
						className="mt-[1px] inline-flex shrink-0 text-link"
					>
						<LoaderCircle
							size={15}
							className="motion-safe:animate-spin"
							aria-hidden="true"
						/>
					</span>
				)}
			</div>
		</header>
	);
}

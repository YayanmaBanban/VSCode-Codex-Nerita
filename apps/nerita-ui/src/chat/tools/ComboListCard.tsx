// ツールの見出しと本文を、アイコンから続く縦線付きの開閉表示にまとめる。
import type { ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import type { ToolSummary } from "@nerita/shared/chatState";
import "./comboListCard.css";

const statusLabels = {
	pending: "待機中",
	in_progress: "実行中",
	completed: "",
	cancelled: "停止",
	failed: "失敗",
};

/** 開閉状態は呼び出し側で管理し、完了時の自動折り畳みにも追従する。 */
export function ComboListCard({
	tool,
	icon,
	open,
	bodyId,
	onToggle,
	children,
}: {
	tool: ToolSummary;
	icon: LucideIcon;
	open: boolean;
	bodyId: string;
	onToggle: () => void;
	children: ReactNode;
}) {
	const Icon = icon;
	return (
		<div
			className="tool-card combo-list-card my-[8px]"
			data-kind={tool.kind}
			data-status={tool.status}
			data-open={open}
		>
			<button
				type="button"
				className="tool-heading group flex w-full min-w-0 cursor-pointer items-center gap-[10px] rounded-[4px] border-0 bg-transparent px-0 py-[6px] text-left text-[12px] text-inherit focus-visible:outline-1 focus-visible:outline-focus hover:bg-menu-hover data-highlighted:bg-menu-hover"
				aria-expanded={open}
				aria-controls={bodyId}
				onClick={onToggle}
			>
				<Icon size={16} className="shrink-0" aria-hidden="true" />
				<span className="min-w-0 [overflow-wrap:anywhere]">
					{tool.title}
				</span>
				{tool.status !== "completed" && (
					<span className="shrink-0 text-[11px]">
						{statusLabels[tool.status]}
					</span>
				)}
				<ChevronDown
					size={12}
					className="combo-list-chevron shrink-0"
					aria-hidden="true"
				/>
			</button>
			<div
				id={bodyId}
				className="combo-list-collapse"
				inert={!open}
				aria-hidden={!open}
			>
				<div className="min-h-0 overflow-hidden">
					<div className="tool-body ml-[7px] flex flex-col gap-[12px] border-0 border-l border-solid border-panel-border py-[6px] pl-[18px] pr-[4px] text-[12px] leading-[1.65]">
						{children}
					</div>
				</div>
			</div>
		</div>
	);
}

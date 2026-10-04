// Agent 一覧と内容ペインを並べ、選択中の項目だけに矢印を表示する。
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "cnfast";
import type { ManagedAgent } from "@nerita/shared/agentManager/messages";
import { SettingsTooltip } from "../chat/SettingsTooltip";

/** 保存形式やバックエンドを知らない共通の選択ペイン。 */
export function AgentBrowser({
	agents,
	selected,
	onSelect,
	busy,
	defaults,
	children,
}: {
	agents: ManagedAgent[];
	selected: string;
	onSelect: (id: string) => void;
	busy: boolean;
	defaults?: boolean;
	children: ReactNode;
}) {
	const items = [
		...(defaults
			? [
					{
						id: "defaults",
						name: "Workspace defaults",
						description: "プロジェクト共通の設定",
					},
				]
			: []),
		...agents,
		...(selected === "new"
			? [{ id: "new", name: "新しい Agent", description: "未保存の定義" }]
			: []),
	];
	return (
		<div className="grid min-w-0 gap-6 sm:grid-cols-[180px_minmax(0,1fr)]">
			<aside className="min-w-0 border-b border-input-border pb-4 sm:border-r sm:border-b-0 sm:pr-4">
				<h2 className="mt-0 mb-3 text-sm font-semibold">Agents</h2>
				<nav aria-label="Agents" className="grid gap-1">
					{items.map((item) => (
						<SettingsTooltip
							key={item.id}
							content={item.description}
						>
							<button
								type="button"
								disabled={busy}
								aria-current={
									selected === item.id ? "page" : undefined
								}
								onClick={() => onSelect(item.id)}
								className={cn(
									"flex min-w-0 items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm break-words",
									"hover:bg-settings-hover focus-visible:outline-2 focus-visible:outline-focus",
									selected === item.id && "bg-settings-hover",
								)}
							>
								<span className="min-w-0 break-words">
									{item.name}
								</span>
								{selected === item.id && (
									<ArrowRight
										size={16}
										className="shrink-0"
										aria-hidden="true"
									/>
								)}
							</button>
						</SettingsTooltip>
					))}
				</nav>
				{!items.length && (
					<p className="text-sm text-muted">
						Agent 定義がありません。
					</p>
				)}
			</aside>
			<section className="min-w-0">{children}</section>
		</div>
	);
}

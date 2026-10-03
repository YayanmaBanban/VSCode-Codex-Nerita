// カテゴリと開いているフォルダーを、直接戻れるパンくずとして表示する。
import { cn } from "cnfast";
import { ChevronRight } from "lucide-react";
import type { WorkspacePath } from "@nerita/shared/workspacePaths";

/** 同名フォルダーも名前ではなく階層の深さで移動先を区別する。 */
export function ContextPickerBreadcrumbs({
	title,
	ancestors,
	onCategories,
	onAncestor,
}: {
	title: string;
	ancestors: WorkspacePath[];
	onCategories: () => void;
	onAncestor: (depth: number) => void;
}) {
	const crumbs = [
		{ key: "root", label: "コンテキストを追加", onClick: onCategories },
	];
	if (title !== "コンテキスト") {
		crumbs.push({
			key: "category",
			label: title,
			onClick: () => onAncestor(0),
		});
	}
	if (title === "ファイルとディレクトリ") {
		crumbs.push(
			...ancestors.map((entry, index) => ({
				key: entry.uri,
				label: entry.name,
				onClick: () => onAncestor(index + 1),
			})),
		);
	}
	return (
		<nav aria-label="コンテキストの階層" className="mb-1 min-w-0">
			<ol
				className={cn(
					"m-0 flex list-none flex-wrap items-center gap-1 p-0 text-[12px]",
				)}
			>
				{crumbs.map((crumb, index) => (
					<li
						key={crumb.key}
						className="flex max-w-full min-w-0 items-center gap-1"
					>
						{index > 0 && (
							<ChevronRight
								size={12}
								className="shrink-0 text-muted"
								aria-hidden="true"
							/>
						)}
						{index === crumbs.length - 1 ? (
							<span
								aria-current="location"
								className="min-w-0 px-1 py-2 break-all text-input-text"
							>
								{crumb.label}
							</span>
						) : (
							<button
								type="button"
								onMouseDown={(event) => event.preventDefault()}
								onClick={crumb.onClick}
								className={cn(
									"min-w-0 rounded border-0 bg-transparent px-1 py-2 text-left break-all",
									"text-muted",
									"hover:bg-settings-hover hover:text-input-text",
									"focus-visible:outline-2 focus-visible:outline-focus",
								)}
							>
								{crumb.label}
							</button>
						)}
					</li>
				))}
			</ol>
		</nav>
	);
}

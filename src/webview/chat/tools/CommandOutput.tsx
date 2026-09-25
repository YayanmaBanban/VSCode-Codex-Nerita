// 大量のコマンド出力を一定量ずつ表示し、追記中は最新ページを追う。
import { useState } from "react";
import { toolOutputClass } from "./toolStyles";

const pageSize = 20_000;

/** 全文を保持しながら DOM に渡す文字数を制限する。 */
export function CommandOutput({ text }: { text: string }) {
	const [selected, setSelected] = useState<number | null>(null);
	const pages = Math.max(1, Math.ceil(text.length / pageSize));
	const page = selected === null ? pages - 1 : Math.min(selected, pages - 1);
	const end =
		selected === null
			? text.length
			: Math.min((page + 1) * pageSize, text.length);
	const start =
		selected === null ? Math.max(0, end - pageSize) : page * pageSize;
	return (
		<>
			{pages > 1 && (
				<div
					className="flex flex-wrap items-center gap-[8px] text-[12px] text-muted"
					aria-label="出力のページ切り替え"
				>
					<span>
						{start + 1}–{end} / {text.length} 文字
					</span>
					<button
						type="button"
						disabled={start === 0}
						onClick={() =>
							setSelected(
								Math.max(0, Math.ceil(start / pageSize) - 1),
							)
						}
					>
						前へ
					</button>
					<button
						type="button"
						disabled={end === text.length}
						onClick={() => setSelected(page + 1)}
					>
						次へ
					</button>
					<button
						type="button"
						disabled={selected === null}
						onClick={() => setSelected(null)}
					>
						最新を表示
					</button>
				</div>
			)}
			<pre className={`${toolOutputClass} max-h-[400px] overflow-auto`}>
				{text.slice(start, end)}
			</pre>
		</>
	);
}

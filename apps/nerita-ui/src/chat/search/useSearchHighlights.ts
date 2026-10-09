// マウント中の行にだけ DOM Range を作り、外れた行への参照を残さない。
import { useEffect, type RefObject } from "react";
import { searchRanges, revealMatch } from "./searchRanges";
import type { SearchHit } from "./searchTimeline";

/** DOM の描画後に強調を更新し、選択した一致箇所を表示領域へ移す。 */
export function useSearchHighlights(
	conversation: RefObject<HTMLElement | null>,
	open: boolean,
	pattern: RegExp | null,
	active: SearchHit | undefined,
	reveal: RefObject<boolean>,
	selection: number,
) {
	useEffect(() => {
		const root = conversation.current;
		if (!open || !pattern || !root) {
			return;
		}
		let frame = 0;
		const update = () => {
			const highlight = new Highlight();
			let selected: Range | undefined;
			let ready = false;
			for (const row of root.querySelectorAll<HTMLElement>(
				"[data-entry-key]",
			)) {
				const { ranges } = searchRanges(row, pattern);
				for (const range of ranges) {
					highlight.add(range);
				}
				if (active && row.dataset.entryKey === active.entryKey) {
					selected = ranges[active.ordinal] ?? ranges[0];
					ready = rowReady(row, active);
				}
			}
			CSS.highlights.set("chat-find-matches", highlight);
			CSS.highlights.set(
				"chat-find-current",
				new Highlight(...(selected ? [selected] : [])),
			);
			if (selected && reveal.current) {
				reveal.current = false;
				revealMatch(selected, root);
			} else if (ready) {
				// Markdown の記号など表示文字に対応しない一致も、行への移動は一度で完了させる。
				reveal.current = false;
			}
		};
		const schedule = () => {
			clearHighlights();
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(update);
		};
		const observer = new MutationObserver(schedule);
		observer.observe(root, {
			childList: true,
			subtree: true,
			characterData: true,
			attributes: true,
			attributeFilter: ["aria-hidden"],
		});
		schedule();
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
			clearHighlights();
		};
	}, [conversation, open, pattern, active, reveal, selection]);
}

/** 画面外の DOM への参照を残さないよう、更新前と終了時に `CSS.highlights` から強調を削除する。 */
function clearHighlights() {
	CSS.highlights.delete("chat-find-matches");
	CSS.highlights.delete("chat-find-current");
}

/** 本文を検索したカードは、展開が描画へ反映されてから移動完了とする。 */
function rowReady(row: HTMLElement, hit: SearchHit) {
	return (
		!hit.body ||
		row.querySelector(".tool-heading[aria-expanded='true']") !== null
	);
}

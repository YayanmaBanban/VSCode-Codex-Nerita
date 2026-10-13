// マウント中の行にだけ DOM Range を作り、外れた行への参照を残さない。

import { searchRanges, revealMatch } from "./searchRanges";
import type { SearchHit } from "./searchTimeline";

/** DOM の描画後に強調を更新し、選択した一致箇所を表示領域へ移す。 */
export function useSearchHighlights(
	conversation: () => HTMLElement | null,
	open: () => boolean,
	pattern: () => RegExp | null,
	active: () => SearchHit | undefined,
	reveal: { current: boolean },
	selection: () => number,
) {
	/** 仮想行と Markdown の更新に合わせて一致区間を再描画し、終了時にハイライトを除く。 */
	const observeSearchHighlights = () => {
		const root = conversation();
		const expression = pattern();
		const selectedHit = active();
		if (!open() || !expression || !root) {
			return;
		}
		let frame = 0;
		/** 描画済みの検索箇所を再走査し、全候補と選択中の候補のハイライトを更新する。 */
		const update = () => {
			const highlight = new Highlight();
			let selected: Range | undefined;
			let ready = false;
			for (const row of root.querySelectorAll<HTMLElement>(
				"[data-entry-key]",
			)) {
				const { ranges } = searchRanges(row, expression);
				for (const range of ranges) {
					highlight.add(range);
				}
				const activeRow =
					selectedHit &&
					row.dataset.entryKey === selectedHit.entryKey;
				if (activeRow === true) {
					selected = ranges[selectedHit.ordinal] ?? ranges[0];
					ready = rowReady(row, selectedHit);
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
		/** 旧ハイライトと更新予約を解除し、次の描画で検索結果の位置を計算し直す。 */
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
	};
	// 検索条件や選択の変更で DOM の強調範囲を作り直し、旧 DOM の監視と参照を解除する。
	$effect(() => {
		selection();
		return observeSearchHighlights();
	});
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

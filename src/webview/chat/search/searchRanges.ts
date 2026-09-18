// 描画済みの会話から検索範囲を作り、ReactのDOMを書き換えずに一致を示す。
import { findMatches, matchLimit } from "./findMatches";

/** インライン装飾をまたいで検索できる、一つの表示ブロック。 */
type TextBlock = {
	element: Element;
	text: string;
	nodes: { node: Text; start: number }[];
};

/** 非表示の折り畳み内容や操作ボタンを除いた、画面上の文章を集める。 */
function textBlocks(root: HTMLElement): TextBlock[] {
	const blocks: TextBlock[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let node: Node | null;
	while ((node = walker.nextNode())) {
		const parent = node.parentElement;
		if (
			!parent ||
			!node.textContent ||
			parent.closest(
				"button,input,textarea,select,svg,script,style,[aria-hidden='true'],.sr-only,.message-actions",
			)
		) {
			continue;
		}
		const range = document.createRange();
		range.selectNodeContents(node);
		if (
			!range.getClientRects().length ||
			getComputedStyle(parent).visibility === "hidden"
		) {
			continue;
		}
		const element =
			parent.closest(
				"p,li,pre,h1,h2,h3,h4,h5,h6,td,th,summary,.message-text,.tool-card,.permission-card",
			) ?? root;
		let block = blocks.at(-1);
		if (!block || block.element !== element) {
			block = { element, text: "", nodes: [] };
			blocks.push(block);
		}
		block.nodes.push({ node: node as Text, start: block.text.length });
		block.text += node.textContent;
	}
	return blocks;
}

/** 文字位置をDOM Rangeへ変換し、一致数が多いときは上限到達も返す。 */
export function searchRanges(
	root: HTMLElement,
	pattern: RegExp,
): { ranges: Range[]; limited: boolean } {
	const ranges: Range[] = [];
	for (const block of textBlocks(root)) {
		for (const match of findMatches(
			block.text,
			pattern,
			matchLimit - ranges.length,
		)) {
			const first = block.nodes.find(
				({ node, start }) => start + node.length > match.start,
			)!;
			const last = block.nodes.find(
				({ node, start }) => start + node.length >= match.end,
			)!;
			const range = document.createRange();
			range.setStart(first.node, match.start - first.start);
			range.setEnd(last.node, match.end - last.start);
			ranges.push(range);
		}
		if (ranges.length >= matchLimit) {
			return { ranges, limited: true };
		}
	}
	return { ranges, limited: false };
}

/** 現在の一致を縦横のスクロール領域内へ移し、入力フォーカスは維持する。 */
export function revealMatch(range: Range, root: HTMLElement): void {
	const parent = range.startContainer.parentElement;
	parent?.scrollIntoView({
		block: "nearest",
		inline: "nearest",
		behavior: "instant",
	});
	for (
		let element = parent;
		element && root.contains(element);
		element = element.parentElement
	) {
		const match = range.getBoundingClientRect();
		const box = element.getBoundingClientRect();
		if (
			element.scrollHeight > element.clientHeight &&
			(match.top < box.top || match.bottom > box.bottom)
		) {
			element.scrollTop += match.top - box.top - element.clientHeight / 2;
		}
		if (
			element.scrollWidth > element.clientWidth &&
			(match.left < box.left || match.right > box.right)
		) {
			element.scrollLeft +=
				match.left - box.left - element.clientWidth / 2;
		}
	}
}

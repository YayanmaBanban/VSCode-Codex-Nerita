// Composerの編集位置とクリップボードイベントを再現する。
import type { Locator } from "@playwright/test";
/** 同じcontenteditable内の指定要素に文字位置で選択範囲を置く。 */
export async function select(element: Locator, start: number, end = start) {
	await element.evaluate(
		(node, offsets) => {
			(node.closest("[contenteditable]") as HTMLElement).focus();
			const walker = document.createTreeWalker(
				node,
				NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
				{
					acceptNode: (item) =>
						item.nodeType === Node.TEXT_NODE ||
						item.nodeName === "BR"
							? NodeFilter.FILTER_ACCEPT
							: NodeFilter.FILTER_SKIP,
				},
			);
			const texts: Node[] = [];
			while (walker.nextNode()) {
				texts.push(walker.currentNode);
			}
			const point = (position: number): [Node, number] => {
				for (const text of texts) {
					if (text.nodeName === "BR") {
						if (position === 0 && text.parentNode) {
							return [
								text.parentNode,
								Array.from(text.parentNode.childNodes).indexOf(
									text as ChildNode,
								),
							];
						}
						position -= 1;
						continue;
					}
					if (position <= (text.textContent?.length ?? 0)) {
						return [text, position];
					}
					position -= text.textContent?.length ?? 0;
				}
				return [node, node.childNodes.length];
			};
			const selection = window.getSelection();
			const range = document.createRange();
			range.setStart(...point(offsets.start));
			range.setEnd(...point(offsets.end));
			selection?.removeAllRanges();
			selection?.addRange(range);
			document.dispatchEvent(new Event("selectionchange"));
		},
		{ start, end },
	);
}

/** 実際のクリップボードイベントをLexicalへ渡す。 */
export async function paste(input: Locator, text: string) {
	await input.evaluate((node, value) => {
		const clipboardData = new DataTransfer();
		clipboardData.setData("text/plain", value);
		node.dispatchEvent(
			new ClipboardEvent("paste", {
				clipboardData,
				bubbles: true,
				cancelable: true,
			}),
		);
	}, text);
}

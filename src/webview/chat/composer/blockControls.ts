// コードブロックの装飾操作を編集本文から分離し、削除をUndo可能にする。
import {
	$addUpdateTag,
	$createParagraphNode,
	$getNodeByKey,
	$isParagraphNode,
	HISTORY_PUSH_TAG,
	type LexicalEditor,
	type NodeKey,
} from "lexical";

/** ブロックだけを削除し、前後の文章を余分な改行なしでつなぎ直す。 */
function $removeBlock(key: NodeKey): void {
	const block = $getNodeByKey(key);
	if (!block?.isAttached()) {
		return;
	}
	$addUpdateTag(HISTORY_PUSH_TAG);
	const before = block.getPreviousSibling();
	const after = block.getNextSibling();
	if ($isParagraphNode(before)) {
		before.selectEnd();
		if ($isParagraphNode(after)) {
			before.append(...after.getChildren());
			after.remove();
		}
	} else if ($isParagraphNode(after)) {
		after.selectStart();
	} else {
		const paragraph = $createParagraphNode();
		block.insertBefore(paragraph);
		paragraph.selectStart();
	}
	block.remove();
}

/** コードのスクロール位置に左右されない、右上の削除ボタンを作る。 */
export function createBlockControls(
	editor: LexicalEditor,
	key: NodeKey,
): HTMLElement {
	const controls = document.createElement("div");
	controls.contentEditable = "false";
	controls.className = "flex h-7 items-center justify-end px-1";
	const button = document.createElement("button");
	button.type = "button";
	button.title = "コードブロックを削除";
	button.setAttribute("aria-label", "コードブロックを削除");
	button.className =
		"flex h-6 w-6 items-center justify-center border-0 bg-transparent p-1 text-muted hover:text-input-text";
	const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	icon.setAttribute("viewBox", "0 0 24 24");
	icon.setAttribute("width", "16");
	icon.setAttribute("height", "16");
	icon.setAttribute("aria-hidden", "true");
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute("d", "M18 6 6 18M6 6l12 12");
	path.setAttribute("stroke", "currentColor");
	path.setAttribute("stroke-width", "2");
	path.setAttribute("stroke-linecap", "round");
	icon.append(path);
	button.append(icon);
	// マウス押下で編集選択を失わず、TabとEnterによる操作も残す。
	button.addEventListener("mousedown", (event) => event.preventDefault());
	button.addEventListener("keydown", (event) => event.stopPropagation());
	button.addEventListener("keyup", (event) => event.stopPropagation());
	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		editor.update(() => $removeBlock(key));
	});
	controls.append(button);
	return controls;
}

/** ホイールがブロックの端に達したら、残りの縦移動をComposer全体へ渡す。 */
export function connectBlockScroll(
	element: HTMLElement,
	editor: LexicalEditor,
): void {
	element.addEventListener(
		"wheel",
		(event) => {
			// ズームと横方向のスクロールはブラウザの標準操作を保つ。
			if (
				event.ctrlKey ||
				event.shiftKey ||
				Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
				event.deltaY === 0
			) {
				return;
			}
			const root = editor.getRootElement();
			if (!root || !event.cancelable) {
				return;
			}
			const unit =
				event.deltaMode === WheelEvent.DOM_DELTA_LINE
					? parseFloat(getComputedStyle(element).lineHeight) || 20
					: event.deltaMode === WheelEvent.DOM_DELTA_PAGE
						? element.clientHeight
						: 1;
			const delta = event.deltaY * unit;
			const maximum = Math.max(
				0,
				element.scrollHeight - element.clientHeight,
			);
			const next = element.scrollTop + delta;
			if (next > 0 && next < maximum) {
				return;
			}
			event.preventDefault();
			const inside =
				Math.max(0, Math.min(maximum, next)) - element.scrollTop;
			element.scrollTop += inside;
			root.scrollTop += delta - inside;
		},
		{ passive: false },
	);
}

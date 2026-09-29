// 同じ Lexical 編集領域の中に、独立スクロール可能なコード領域を配置する。
import {
	$applyNodeReplacement,
	ElementNode,
	type EditorConfig,
	type LexicalEditor,
	type ElementDOMSlot,
	type DOMExportOutput,
	type SerializedElementNode,
} from "lexical";
import { connectBlockScroll, createBlockControls } from "./blockControls";

/** 子テキストを直接編集できる、貼り付け専用のブロック要素。 */
export class PastedBlockNode extends ElementNode {
	/** 保存形式で使うノード種別を返す。 */
	static override getType(): string {
		return "pasted-block";
	}
	/** 取り消し操作用のスナップショットへ同じキーで複製する。 */
	static override clone(node: PastedBlockNode): PastedBlockNode {
		return new PastedBlockNode(node.__key);
	}
	/** Lexical の履歴・シリアライズ形式から復元する。 */
	static override importJSON(
		serialized: SerializedElementNode,
	): PastedBlockNode {
		return $createPastedBlockNode().updateFromJSON(serialized);
	}
	/** 編集可能な子要素を格納するスクロール領域を作る。 */
	override createDOM(
		_config: EditorConfig,
		editor: LexicalEditor,
	): HTMLElement {
		const wrapper = document.createElement("div");
		wrapper.className =
			"composer-code-block my-2 overflow-hidden rounded-md border border-solid border-input-border bg-diff-hunk";
		const element = document.createElement("pre");
		element.className =
			"composer-code m-0 max-h-[160px] overflow-auto overscroll-x-contain overscroll-y-auto px-3 pb-3 font-editor text-[12px] leading-[1.7] whitespace-pre [scrollbar-width:thin]";
		element.setAttribute("aria-label", "貼り付けコードブロック");
		connectBlockScroll(element, editor);
		wrapper.append(createBlockControls(editor, this.getKey()), element);
		return wrapper;
	}
	/** ボタンを Lexical の本文管理から外し、`pre` の中だけを編集する。 */
	override getDOMSlot(element: HTMLElement): ElementDOMSlot<HTMLElement> {
		return super.getDOMSlot(element.querySelector("pre") ?? element);
	}
	/** クリップボードの HTML には操作ボタンを含めない。 */
	override exportDOM(): DOMExportOutput {
		return { element: document.createElement("pre") };
	}
	/** 入力時に DOM を置換せず選択と内部スクロールを保持する。 */
	override updateDOM(): boolean {
		return false;
	}
	/** 通常文のインデント操作からブロックを除外する。 */
	override canIndent(): boolean {
		return false;
	}
	/** 子要素とブロック種別を履歴へ保存する。 */
	override exportJSON(): SerializedElementNode {
		return { ...super.exportJSON(), type: "pasted-block", version: 1 };
	}
}

/** Lexical の更新内で貼り付けブロックを生成する。 */
export function $createPastedBlockNode(): PastedBlockNode {
	return $applyNodeReplacement(new PastedBlockNode());
}

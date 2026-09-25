// パスを編集不能なインラインチップで表示し、本文には完全なパスを返す。
import {
	$applyNodeReplacement,
	DecoratorNode,
	type NodeKey,
	type SerializedLexicalNode,
	type DOMExportOutput,
} from "lexical";
import type { ReactElement } from "react";
import type { ComposerTarget } from "../../../shared/composerTargets";
import { pathText } from "../../../shared/composerReferences";
import { PathReferenceChip } from "./PathReferenceChip";

/** 元に戻す操作とクリップボードの内部形式に保存するパス情報。 */
type SerializedPathReference = SerializedLexicalNode & { path: ComposerTarget };

/** 見た目のファイル名と、送信用のパス文字列を分離するノード。 */
export class PathReferenceNode extends DecoratorNode<ReactElement> {
	__path: ComposerTarget;
	/** 参照先と履歴用キーを保持する。 */
	constructor(path: ComposerTarget, key?: NodeKey) {
		super(key);
		this.__path = path;
	}
	/** 保存形式の種別を返す。 */
	static override getType(): string {
		return "path-reference";
	}
	/** 履歴へ同じ参照を複製する。 */
	static override clone(node: PathReferenceNode): PathReferenceNode {
		return new PathReferenceNode(node.__path, node.__key);
	}
	/** 内部シリアライズからチップを復元する。 */
	static override importJSON(
		value: SerializedPathReference,
	): PathReferenceNode {
		return $createPathReferenceNode(value.path);
	}
	/** 保存対象の参照情報を返す。 */
	getPath(): ComposerTarget {
		return this.getLatest().__path;
	}
	/** 送信とコピーには省略しないパスを使う。 */
	override getTextContent(): string {
		return pathText(this.getPath());
	}
	/** 段落内の一要素として扱う。 */
	override isInline(): boolean {
		return true;
	}
	/** 矢印キーではノード選択に入らず、前後の本文へカーソルを通す。 */
	override isKeyboardSelectable(): boolean {
		return false;
	}
	/** チップ内部へ文字カーソルを入れない。 */
	override createDOM(): HTMLElement {
		const element = document.createElement("span");
		element.contentEditable = "false";
		element.className =
			"inline-path-reference inline-block max-w-full align-middle";
		return element;
	}
	/** 選択を保つため、外側の DOM を再作成しない。 */
	override updateDOM(): boolean {
		return false;
	}
	/** 外部の HTML 貼り付け先にも完全なパスを渡す。 */
	override exportDOM(): DOMExportOutput {
		const element = document.createElement("span");
		element.textContent = this.getTextContent();
		return { element };
	}
	/** 履歴へ参照情報を保存する。 */
	override exportJSON(): SerializedPathReference {
		return {
			...super.exportJSON(),
			type: "path-reference",
			version: 1,
			path: this.getPath(),
		};
	}
	/** React で添付と同じアイコン・枠・削除操作を描画する。 */
	override decorate(): ReactElement {
		return (
			<PathReferenceChip nodeKey={this.getKey()} path={this.getPath()} />
		);
	}
}

/** Lexical の更新内でパスチップを作る。 */
export function $createPathReferenceNode(
	path: ComposerTarget,
): PathReferenceNode {
	return $applyNodeReplacement(new PathReferenceNode(path));
}

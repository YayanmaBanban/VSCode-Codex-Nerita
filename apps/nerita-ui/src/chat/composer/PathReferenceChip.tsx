// 入力文中のパスを添付風に表示し、取り消し可能な操作で参照だけを外す。
import { X } from "lucide-react";
import { cn } from "cnfast";
import { pathText } from "@nerita/shared/composerReferences";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { $getNodeByKey, HISTORY_PUSH_TAG, type NodeKey } from "lexical";
import type { ComposerTarget } from "@nerita/shared/composerTargets";
import {
	referenceKindLabel,
	referenceActionLabel,
} from "./referencePresentation";
import { OPEN_REFERENCE_COMMAND } from "./ReferenceActionsPlugin";

import { ReferenceChipContent } from "../ReferenceChipContent";

/** 参照チップ全体の配置と枠線を定義する。 */
const referenceChipStyle = cn(
	"inline-flex max-w-full items-center align-middle",
	"[&_svg]:shrink-0",
	"rounded-[5px] border border-solid border-panel-border bg-input text-[12px]",
	"leading-normal",
);

/** 参照を開くボタンの配置と操作状態を定義する。 */
const referenceOpenStyle = cn(
	"inline-flex min-w-0 items-center gap-[5px] border-0 bg-transparent px-[5px]",
	"py-[4px]",
	"hover:bg-settings-hover",
	"focus-visible:outline-2 focus-visible:outline-focus",
);

/** 参照を取り外すボタンの配置と操作状態を定義する。 */
const referenceRemoveStyle = cn(
	`inline-flex shrink-0 items-center border-0 bg-transparent px-[5px] py-[4px]`,
	"hover:bg-settings-hover",
	"focus-visible:outline-2 focus-visible:outline-focus",
);

/** 省略した名前の全文とパスはホバーでも確認できる。 */
export function PathReferenceChip({
	nodeKey,
	path,
}: {
	nodeKey: NodeKey;
	path: ComposerTarget;
}) {
	const [editor] = useLexicalComposerContext();
	const editable = useLexicalEditable();
	return (
		<span
			title={pathText(path)}
			aria-label={`${referenceKindLabel(path)}: ${pathText(path)}`}
			className={referenceChipStyle}
		>
			<button
				type="button"
				disabled={!editable}
				aria-label={referenceActionLabel(path)}
				className={referenceOpenStyle}
				onMouseDown={(event) => event.preventDefault()}
				onKeyDown={(event) => event.stopPropagation()}
				onKeyUp={(event) => event.stopPropagation()}
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					editor.dispatchCommand(OPEN_REFERENCE_COMMAND, path);
				}}
			>
				<ReferenceChipContent path={path} />
			</button>
			<button
				type="button"
				disabled={!editable}
				aria-label={`${path.name} の参照を取り外す`}
				className={referenceRemoveStyle}
				onMouseDown={(event) => event.preventDefault()}
				onKeyDown={(event) => event.stopPropagation()}
				onKeyUp={(event) => event.stopPropagation()}
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					editor.update(
						() => {
							const node = $getNodeByKey(nodeKey);
							if (node?.isAttached() === true) {
								node.selectPrevious();
								node.remove();
							}
						},
						{ tag: HISTORY_PUSH_TAG },
					);
					editor.focus();
				}}
			>
				<X size={12} aria-hidden="true" />
			</button>
		</span>
	);
}

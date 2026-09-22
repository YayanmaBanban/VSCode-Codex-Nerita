// 入力文中のパスを添付風に表示し、参照だけをUndo可能に取り外す。
import { X } from "lucide-react";
import { pathText } from "../../../shared/composerReferences";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { $getNodeByKey, HISTORY_PUSH_TAG, type NodeKey } from "lexical";
import type { ComposerTarget } from "../../../shared/composerTargets";
import {
	referenceIcon,
	referenceKindLabel,
	referenceActionLabel,
} from "./referencePresentation";
import { OPEN_REFERENCE_COMMAND } from "./ReferenceActionsPlugin";

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
	const Icon = referenceIcon(path);
	return (
		<span
			title={pathText(path)}
			aria-label={`${referenceKindLabel(path)}: ${pathText(path)}`}
			className="inline-flex max-w-full items-center rounded-[5px] border border-solid border-panel-border bg-input text-[12px] leading-normal align-middle [&_svg]:shrink-0"
		>
			<button
				type="button"
				disabled={!editable}
				aria-label={referenceActionLabel(path)}
				className="inline-flex min-w-0 items-center gap-[5px] border-0 bg-transparent px-[5px] py-[4px] hover:bg-settings-hover focus-visible:outline-2 focus-visible:outline-focus"
				onMouseDown={(event) => event.preventDefault()}
				onKeyDown={(event) => event.stopPropagation()}
				onKeyUp={(event) => event.stopPropagation()}
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					editor.dispatchCommand(OPEN_REFERENCE_COMMAND, path);
				}}
			>
				<Icon size={14} aria-hidden="true" />
				<span className="truncate">
					{path.name}
					{path.kind === "file" && path.range
						? `(${path.range.start.line}:${path.range.end.line})`
						: ""}
				</span>
			</button>
			<button
				type="button"
				disabled={!editable}
				aria-label={`${path.name} の参照を取り外す`}
				className="inline-flex shrink-0 items-center border-0 bg-transparent px-[5px] py-[4px] hover:bg-settings-hover focus-visible:outline-2 focus-visible:outline-focus"
				onMouseDown={(event) => event.preventDefault()}
				onKeyDown={(event) => event.stopPropagation()}
				onKeyUp={(event) => event.stopPropagation()}
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					editor.update(
						() => {
							const node = $getNodeByKey(nodeKey);
							if (node?.isAttached()) {
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

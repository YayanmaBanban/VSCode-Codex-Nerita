// 候補メニューをLexicalの選択範囲と接続し、通常の送信より先にキーを処理する。
import { useId, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { Attachment } from "../../../shared/composer";
import type { SkillSummary } from "../../../shared/skills";
import { useCompletionEditor } from "./useCompletionEditor";
import {
	$insertCompletion,
	completionItems,
	type Completion,
	type CompletionItem,
} from "./completions";
import { CompletionMenu } from "./CompletionMenu";

/** 候補選択とTabの字下げを、本文のUndo履歴へ反映する。 */
export function CompletionPlugin({
	attachments,
	skills,
}: {
	attachments: Attachment[];
	skills: SkillSummary[];
}) {
	const [editor] = useLexicalComposerContext();
	const [match, setMatch] = useState<Completion | null>(null);
	const [category, setCategory] = useState("");
	const [search, setSearch] = useState<string | null>(null);
	const [selected, setSelected] = useState(0);
	const dismissed = useRef("");
	const container = useRef<HTMLDivElement>(null);
	const id = useId();
	const query = search ?? match?.query ?? "";
	const items = completionItems(
		match?.marker ?? "",
		category,
		query,
		attachments,
		skills,
	);
	const index = Math.min(selected, Math.max(0, items.length - 1));
	const close = () => {
		dismissed.current = JSON.stringify(match);
		setMatch(null);
	};
	const back = () => {
		setCategory("");
		setSearch("");
		setSelected(0);
	};
	const pick = (item: CompletionItem) => {
		if (item.category) {
			setCategory(item.category);
			setSearch("");
			setSelected(0);
			return;
		}
		if (!match || item.text === undefined) {
			return;
		}
		editor.update(() => $insertCompletion(match, item.text!));
		setMatch(null);
		editor.focus();
	};
	/** IME確定と修飾キーは候補選択に使わず、未確定の本文を送信しない。 */
	const handleKey = (event: KeyboardEvent, inSearch = false) => {
		if (
			event.isComposing ||
			event.keyCode === 229 ||
			editor.isComposing()
		) {
			return false;
		}
		if (!match || event.ctrlKey || event.metaKey || event.altKey) {
			return false;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			close();
			editor.focus();
			return true;
		}
		if (event.key === "ArrowLeft" && category && !inSearch) {
			event.preventDefault();
			back();
			return true;
		}
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			setSelected(
				items.length
					? (index +
							(event.key === "ArrowDown"
								? 1
								: items.length - 1)) %
							items.length
					: 0,
			);
			return true;
		}
		if (
			(event.key === "Enter" ||
				event.key === "Tab" ||
				(event.key === "ArrowRight" && items[index]?.category)) &&
			!event.shiftKey
		) {
			event.preventDefault();
			if (items[index]) {
				pick(items[index]);
			}
			return true;
		}
		return false;
	};
	useCompletionEditor(editor, {
		match,
		dismissed,
		container,
		handleKey,
		id,
		selected: items[index] ? index : null,
		onMatch: (next) => {
			setMatch(next);
			setSearch(null);
			if (
				next?.marker !== match?.marker ||
				next?.key !== match?.key ||
				next?.start !== match?.start
			) {
				setCategory("");
			}
			setSelected(0);
		},
	});
	if (!match) {
		return null;
	}
	const title =
		match.marker === "/"
			? "スラッシュコマンド"
			: match.marker === "@"
				? "スキル"
				: category || "コンテキスト";
	return (
		<div ref={container}>
			<CompletionMenu
				id={id}
				title={title}
				query={query}
				items={items}
				selected={index}
				empty={
					category && category !== "添付ファイル"
						? "このコンテキストは今後対応予定です。"
						: category === "添付ファイル" && !attachments.length
							? "添付ファイルはありません。"
							: "候補がありません。"
				}
				onQuery={(value) => {
					setSearch(value);
					setSelected(0);
				}}
				onKeyDown={(event) => {
					if (handleKey(event.nativeEvent, true)) {
						event.stopPropagation();
					}
				}}
				onPick={pick}
				onBack={category ? back : undefined}
			/>
		</div>
	);
}

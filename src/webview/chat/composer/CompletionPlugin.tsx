// 候補メニューを Lexical の選択範囲と接続し、通常の送信より先にキーを処理する。
import { useEffect, useId, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { Attachment } from "../../../shared/composer";
import type { SkillSummary } from "../../../shared/skills";
import { handleCompletionKey } from "./completionKeyboard";
import { useCompletionEditor } from "./useCompletionEditor";
import {
	$buttonCompletion,
	$completion,
	$insertCompletion,
	type Completion,
} from "./completions";
import type { CompletionItem } from "./completionItems";
import { CompletionMenu } from "./CompletionMenu";
import { ContextPicker } from "./ContextPicker";
import type { Bridge } from "../../vscodeBridge";
import { useCompletionCandidates } from "./useCompletionCandidates";
import { usePastedPath } from "./usePastedPath";

/** 候補選択と Tab の字下げを、本文の編集履歴へ反映する。 */
export function CompletionPlugin({
	bridge,
	attachments,
	skills,
	collaborationModes,
	contextRequest,
	onAttach,
}: {
	bridge?: Bridge | undefined;
	attachments: Attachment[];
	skills: SkillSummary[];
	collaborationModes?: boolean;
	contextRequest?: number | undefined;
	onAttach?: (() => void) | undefined;
}) {
	const [editor] = useLexicalComposerContext();
	usePastedPath(editor, bridge);
	const [match, setMatch] = useState<Completion | null>(null);
	const [category, setCategory] = useState("");
	const [search, setSearch] = useState<string | null>(null);
	const [selected, setSelected] = useState(0);
	const [source, setSource] = useState<"button" | "inline">("inline");
	const [recent, setRecent] = useState<CompletionItem[]>([]);
	const lastRequest = useRef(contextRequest);
	const dismissed = useRef("");
	const container = useRef<HTMLDivElement>(null);
	const id = useId();
	const marker = match?.marker;
	const query = completionQuery(search, match);
	const { items, empty, notice, paths, browsing, sessions } =
		useCompletionCandidates({
			bridge,
			marker,
			category,
			query,
			attachments,
			skills,
			collaborationModes,
			canAttach: Boolean(onAttach),
		});
	useEffect(() => {
		if (contextRequest === lastRequest.current) {
			return;
		}
		lastRequest.current = contextRequest;
		setMatch(editor.getEditorState().read($buttonCompletion));
		setSource("button");
		setCategory("");
		setSearch("");
		setSelected(0);
	}, [contextRequest, editor]);
	const index = Math.min(selected, Math.max(0, items.length - 1));
	const close = () => {
		dismissed.current = JSON.stringify(
			editor.getEditorState().read($completion),
		);
		setMatch(null);
	};
	const back = () => {
		if (browsing && paths.hasParent) {
			paths.back();
		} else {
			setCategory("");
		}
		setSearch("");
		setSelected(0);
	};
	/** 添付の追加では本文の検索文字だけを取り除く。 */
	const addAttachment = () => {
		if (!onAttach) {
			return;
		}
		if (match && source === "inline") {
			editor.update(() => $insertCompletion(match, ""));
		}
		close();
		onAttach();
	};
	const pick = (item: CompletionItem) => {
		if (item.disabled) {
			return;
		}
		if (item.category === "添付ファイル") {
			addAttachment();
			return;
		}
		if (item.more) {
			sessions.more();
			return;
		}
		if (item.directory) {
			paths.open(item.directory);
			setSearch("");
			setSelected(0);
			return;
		}
		if (item.category) {
			paths.reset();
			setCategory(item.category);
			setSearch("");
			setSelected(0);
			return;
		}
		if (!match || item.text === undefined) {
			return;
		}
		editor.update(() =>
			$insertCompletion(match, item.text!, item.reference),
		);
		if (item.reference) {
			setRecent((previous) =>
				[
					item,
					...previous.filter(
						(entry) =>
							JSON.stringify(entry.reference) !==
							JSON.stringify(item.reference),
					),
				].slice(0, 5),
			);
		}
		setMatch(null);
		editor.focus();
	};
	const handleKey = (event: KeyboardEvent, inSearch = false) =>
		handleCompletionKey(
			event,
			{
				editor,
				match,
				category,
				items,
				index,
				close,
				back,
				pick,
				setSelected,
			},
			inSearch,
		);

	useCompletionEditor(editor, {
		match,
		dismissed,
		container,
		handleKey,
		id,
		selected: items[index] ? index : null,
		onMatch: (next) => {
			setSource("inline");
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
	const title = completionTitle(match.marker, category);
	const Menu = match.marker === "#" ? ContextPicker : CompletionMenu;
	return (
		<div
			ref={container}
			onKeyDown={(event) => {
				if (
					event.key === "Escape" ||
					(event.altKey && event.key === "ArrowLeft")
				) {
					if (handleKey(event.nativeEvent, true)) {
						event.stopPropagation();
					}
				}
			}}
		>
			<Menu
				ancestors={paths.ancestors}
				onAncestor={(depth) => {
					paths.goTo(depth);
					setSearch("");
					setSelected(0);
				}}
				recent={recent}
				onCategories={() => {
					paths.reset();
					setCategory("");
					setSearch("");
					setSelected(0);
				}}
				autoFocus={source === "button"}
				id={id}
				title={title}
				query={query}
				items={items}
				selected={index}
				location={browsing ? paths.path : undefined}
				notice={notice}
				empty={empty}
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
			/>
		</div>
	);
}

/** 検索欄の入力を本文から検出した候補文字列より優先する。 */
function completionQuery(search: string | null, match: Completion | null) {
	return search ?? match?.query ?? "";
}

/** 入力マーカーとカテゴリから候補メニューの見出しを決める。 */
function completionTitle(marker: string, category: string): string {
	if (marker === "/") {
		return "スラッシュコマンド";
	}
	if (marker === "@") {
		return "スキル";
	}
	return category || "コンテキスト";
}

// 候補メニューをLexicalの選択範囲と接続し、通常の送信より先にキーを処理する。
import { useId, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { Attachment } from "../../../shared/composer";
import type { SkillSummary } from "../../../shared/skills";
import { handleCompletionKey } from "./completionKeyboard";
import { useCompletionEditor } from "./useCompletionEditor";
import { $insertCompletion, type Completion } from "./completions";
import { completionItems, type CompletionItem } from "./completionItems";
import { CompletionMenu } from "./CompletionMenu";
import type { Bridge } from "../../vscodeBridge";
import { useWorkspacePaths } from "./useWorkspacePaths";
import { useWorkspaceSymbols } from "./useWorkspaceSymbols";
import { useSessionReferences } from "./useSessionReferences";
import { usePastedPath } from "./usePastedPath";

/** 候補選択とTabの字下げを、本文のUndo履歴へ反映する。 */
export function CompletionPlugin({
	bridge,
	attachments,
	skills,
	collaborationModes = false,
}: {
	bridge?: Bridge | undefined;
	attachments: Attachment[];
	skills: SkillSummary[];
	collaborationModes?: boolean;
}) {
	const [editor] = useLexicalComposerContext();
	usePastedPath(editor, bridge);
	const [match, setMatch] = useState<Completion | null>(null);
	const [category, setCategory] = useState("");
	const [search, setSearch] = useState<string | null>(null);
	const [selected, setSelected] = useState(0);
	const dismissed = useRef("");
	const container = useRef<HTMLDivElement>(null);
	const id = useId();
	const marker = match?.marker;
	const query = completionQuery(search, match);
	const browsing = marker === "#" && category === "ファイルとディレクトリ";
	const paths = useWorkspacePaths(bridge, browsing, query);
	const searchingSymbols = marker === "#" && category === "シンボル";
	const symbols = useWorkspaceSymbols(bridge, searchingSymbols, query);
	const searchingSessions = marker === "#" && category === "セッション";
	const sessions = useSessionReferences(bridge, searchingSessions, query);
	/** 選択中のカテゴリに属する候補と案内をまとめて返す。 */
	function candidates(): {
		items: CompletionItem[];
		empty: string;
		notice?: string | undefined;
	} {
		if (browsing) {
			return { items: paths.items, empty: paths.empty };
		}
		if (searchingSymbols) {
			return symbols;
		}
		if (searchingSessions) {
			return sessions;
		}
		return {
			items: completionItems(
				match?.marker ?? "",
				category,
				query,
				attachments,
				skills,
				collaborationModes,
			),
			empty:
				category === "添付ファイル" && !attachments.length
					? "添付ファイルはありません。"
					: "候補がありません。",
		};
	}
	const { items, empty, notice } = candidates();
	const index = Math.min(selected, Math.max(0, items.length - 1));
	const close = () => {
		dismissed.current = JSON.stringify(match);
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
	const pick = (item: CompletionItem) => {
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
	return (
		<div ref={container}>
			<CompletionMenu
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
				onBack={category ? back : undefined}
				backLabel={completionBackLabel(browsing, paths.hasParent)}
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

/** ファイル階層内でのみ親ディレクトリへの移動を案内する。 */
function completionBackLabel(browsing: boolean, hasParent: boolean): string {
	return browsing && hasParent ? "上の階層へ戻る" : "カテゴリへ戻る";
}

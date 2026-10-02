// 候補メニューを Lexical の選択範囲と接続し、通常の送信より先にキーを処理する。

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { Bridge } from "@nerita/shared/bridge";
import type { Attachment } from "@nerita/shared/composer";
import type { SkillSummary } from "@nerita/shared/skills";
import { type WorkspacePath } from "@nerita/shared/workspacePaths";
import { type LexicalEditor } from "lexical";
import {
	useEffect,
	useId,
	useRef,
	useState,
	type ComponentProps,
	type Dispatch,
	type JSX,
	type RefObject,
	type SetStateAction,
} from "react";
import type { CompletionItem } from "./completionItems";
import { handleCompletionKey } from "./completionKeyboard";
import { CompletionMenu } from "./CompletionMenu";
import {
	$buttonCompletion,
	$completion,
	$insertCompletion,
	type Completion,
} from "./completions";
import { ContextPicker } from "./ContextPicker";
import { useCompletionCandidates } from "./useCompletionCandidates";
import { useCompletionEditor } from "./useCompletionEditor";
import { usePastedPath } from "./usePastedPath";

/** 補完に使う添付・スキル・通信先と、メニューを開く要求・添付操作。 */
type CompletionPluginProps = {
	bridge?: Bridge | undefined;
	attachments: Attachment[];
	skills: SkillSummary[];
	collaborationModes?: boolean;
	contextRequest?: number | undefined;
	onAttach?: (() => void) | undefined;
};

/** 候補選択と Tab の字下げを、本文の編集履歴へ反映する。 */
export function CompletionPlugin(props: CompletionPluginProps) {
	const [editor] = useLexicalComposerContext();
	usePastedPath(editor, props.bridge);
	const state = useCompletionState(editor, props.contextRequest);
	const query = completionQuery(state.search, state.match);
	const candidates = useCompletionCandidates({
		...props,
		bridge: props.bridge,
		collaborationModes: props.collaborationModes,
		marker: state.match?.marker,
		category: state.category,
		query,
		canAttach: Boolean(props.onAttach),
	});
	const actions = useCompletionActions(
		editor,
		state,
		candidates,
		props.onAttach,
	);
	if (!state.match) {
		return null;
	}
	const title = completionTitle(state.match.marker, state.category);
	const Menu = state.match.marker === "#" ? ContextPicker : CompletionMenu;
	return (
		<CompletionPanel
			container={state.container}
			handleKey={actions.handleKey}
			Menu={Menu}
			paths={candidates.paths}
			setSearch={state.setSearch}
			setSelected={state.setSelected}
			recent={state.recent}
			setCategory={state.setCategory}
			source={state.source}
			id={state.id}
			title={title}
			query={query}
			items={candidates.items}
			index={actions.index}
			browsing={candidates.browsing}
			notice={candidates.notice}
			empty={candidates.empty}
			pick={actions.pick}
		/>
	);
}
/** 補完の起点と検索状態を保持し、ボタンからの要求で初期化する。 */
function useCompletionState(
	editor: LexicalEditor,
	contextRequest: number | undefined,
) {
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
	return {
		match,
		setMatch,
		category,
		setCategory,
		search,
		setSearch,
		selected,
		setSelected,
		source,
		setSource,
		recent,
		setRecent,
		dismissed,
		container,
		id,
	};
}
/** 候補の操作と Lexical のキー処理を同じ編集状態へ接続する。 */
function useCompletionActions(
	editor: LexicalEditor,
	state: ReturnType<typeof useCompletionState>,
	candidates: ReturnType<typeof useCompletionCandidates>,
	onAttach: (() => void) | undefined,
) {
	const index = Math.min(
		state.selected,
		Math.max(0, candidates.items.length - 1),
	);
	const close = () => {
		state.dismissed.current = JSON.stringify(
			editor.getEditorState().read($completion),
		);
		state.setMatch(null);
	};
	const back = () => {
		if (candidates.browsing && candidates.paths.hasParent) {
			candidates.paths.back();
		} else {
			state.setCategory("");
		}
		state.setSearch("");
		state.setSelected(0);
	};
	/** 添付の追加では本文の検索文字だけを取り除く。 */
	const addAttachment = createAttachmentCompletion(
		onAttach,
		state.match,
		state.source,
		editor,
		close,
	);
	const pick = createCompletionPicker(
		addAttachment,
		candidates.sessions,
		candidates.paths,
		state.setSearch,
		state.setSelected,
		state.setCategory,
		state.match,
		editor,
		state.setRecent,
		state.setMatch,
	);
	const handleKey = (event: KeyboardEvent, inSearch = false) =>
		handleCompletionKey(
			event,
			{
				editor,
				match: state.match,
				category: state.category,
				items: candidates.items,
				index,
				close,
				back,
				pick,
				setSelected: state.setSelected,
			},
			inSearch,
		);

	useCompletionEditor(editor, {
		match: state.match,
		dismissed: state.dismissed,
		container: state.container,
		handleKey,
		id: state.id,
		selected: candidates.items[index] ? index : null,
		onMatch: createCompletionMatchUpdater(state),
	});
	return { index, pick, handleKey };
}

/** 補完位置が変わった場合に候補と選択位置を初期化する。 */
function createCompletionMatchUpdater(
	state: ReturnType<typeof useCompletionState>,
): (match: Completion | null) => void {
	return (next) => {
		state.setSource("inline");
		state.setMatch(next);
		state.setSearch(null);
		if (
			next?.marker !== state.match?.marker ||
			next?.key !== state.match?.key ||
			next?.start !== state.match?.start
		) {
			state.setCategory("");
		}
		state.setSelected(0);
	};
}

/** インライン補完文字列を取り除いて添付操作を開始する。 */
function createAttachmentCompletion(
	onAttach: (() => void) | undefined,
	match: Completion | null,
	source: "button" | "inline",
	editor: LexicalEditor,
	close: () => void,
) {
	return () => {
		if (!onAttach) {
			return;
		}
		if (match && source === "inline") {
			editor.update(() => $insertCompletion(match, ""));
		}
		close();
		onAttach();
	};
}

/** 補完メニューの候補・検索・階層移動の状態と操作。 */
type CompletionPanelProps = {
	container: RefObject<HTMLDivElement | null>;
	handleKey: (event: KeyboardEvent, inSearch?: boolean) => boolean;
	Menu: ({
		recent,
		onCategories,
		ancestors,
		onAncestor,
		...props
	}: ComponentProps<typeof CompletionMenu> & {
		recent: CompletionItem[];
		onCategories: () => void;
		ancestors: WorkspacePath[];
		onAncestor: (depth: number) => void;
	}) => JSX.Element;
	paths: {
		ancestors: WorkspacePath[];
		goTo: (depth: number) => void;
		items: CompletionItem[];
		path: string;
		empty: string;
		open: (entry: WorkspacePath) => void;
		back: () => void;
		reset: () => void;
		hasParent: boolean;
	};
	setSearch: Dispatch<SetStateAction<string | null>>;
	setSelected: Dispatch<SetStateAction<number>>;
	recent: CompletionItem[];
	setCategory: Dispatch<SetStateAction<string>>;
	source: "button" | "inline";
	id: string;
	title: string;
	query: string;
	items: CompletionItem[];
	index: number;
	browsing: boolean;
	notice: undefined | string;
	empty: string;
	pick: (item: CompletionItem) => void;
};

/** 補完メニューの検索・階層移動とキー操作をまとめる。 */
function CompletionPanel(props: CompletionPanelProps) {
	const {
		container,
		handleKey,
		Menu,
		paths,
		setSearch,
		setSelected,
		setCategory,
		source,
		index,
		browsing,
		pick,
	} = props;
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
				{...props}
				onCategories={() => {
					paths.reset();
					setCategory("");
					setSearch("");
					setSelected(0);
				}}
				autoFocus={source === "button"}
				selected={index}
				location={browsing ? paths.path : undefined}
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

/** 選択したカテゴリ・参照・添付を本文の補完操作へ接続する。 */
function createCompletionPicker(
	addAttachment: () => void,
	sessions: {
		items: CompletionItem[];
		empty: string;
		notice: string;
		more: () => void;
	},
	paths: {
		ancestors: WorkspacePath[];
		goTo: (depth: number) => void;
		items: CompletionItem[];
		path: string;
		empty: string;
		open: (entry: WorkspacePath) => void;
		back: () => void;
		reset: () => void;
		hasParent: boolean;
	},
	setSearch: Dispatch<SetStateAction<string | null>>,
	setSelected: Dispatch<SetStateAction<number>>,
	setCategory: Dispatch<SetStateAction<string>>,
	match: null | Completion,
	editor: LexicalEditor,
	setRecent: Dispatch<SetStateAction<CompletionItem[]>>,
	setMatch: Dispatch<SetStateAction<Completion | null>>,
) {
	return (item: CompletionItem) => {
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

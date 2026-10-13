<!-- 入力位置に応じたコマンド・スキル・参照候補を取得し、選択した候補を Lexical の本文へ挿入する。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import type { Bridge } from "@nerita/shared/bridge";
	import type { Attachment } from "@nerita/shared/composer";
	import type { SkillSummary } from "@nerita/shared/skills";
	import { nonEmptyString } from "@nerita/shared/valuePredicates";
	import { getLexicalEditor } from "./lexicalContext";
	import type { CompletionItem } from "./completionItems";
	import { handleCompletionKey } from "./completionKeyboard";
	import {
		$buttonCompletion as buttonCompletion,
		$completion as completion,
		$insertCompletion as insertCompletion,
		type Completion,
	} from "./completions";
	import CompletionMenu from "./CompletionMenu.svelte";
	import ContextPicker from "./ContextPicker.svelte";
	import { useCompletionCandidates } from "./useCompletionCandidates.svelte";
	import { useCompletionEditor } from "./useCompletionEditor.svelte";
	import { usePastedPath } from "./usePastedPath.svelte";

	let props: {
		bridge?: Bridge | undefined;
		attachments: Attachment[];
		skills: SkillSummary[];
		collaborationModes?: boolean;
		contextRequest?: number | undefined;
		onAttach?: (() => void) | undefined;
	} = $props();
	const editor = getLexicalEditor();
	usePastedPath({
		editor,
		get bridge() {
			return props.bridge;
		},
	});
	let match = $state.raw<Completion | null>(null);
	let category = $state("");
	let search: string | null = $state(null);
	let selected = $state(0);
	let source: "button" | "inline" = $state("inline");
	let recent: CompletionItem[] = $state.raw([]);
	let lastRequest = untrack(() => props.contextRequest);
	const dismissed = { current: "" };
	let container: HTMLDivElement | undefined = $state();
	const containerRef = {
		get current() {
			return container ?? null;
		},
	};
	const id = $props.id();
	let query = $derived(search ?? match?.query ?? "");
	let title = $derived(completionTitle());
	/** 補完の起点と選択カテゴリーに応じて、候補メニューの見出しを選ぶ。 */
	function completionTitle() {
		if (match?.marker === "/") {
			return "スラッシュコマンド";
		}
		if (match?.marker === "@") {
			return "スキル";
		}
		return nonEmptyString(category) ?? "コンテキスト";
	}
	const candidates = useCompletionCandidates({
		get bridge() {
			return props.bridge;
		},
		get marker() {
			return match?.marker;
		},
		get category() {
			return category;
		},
		get query() {
			return query;
		},
		get attachments() {
			return props.attachments;
		},
		get skills() {
			return props.skills;
		},
		get collaborationModes() {
			return props.collaborationModes;
		},
		get canAttach() {
			return Boolean(props.onAttach);
		},
	});
	let index = $derived(
		Math.min(selected, Math.max(0, candidates.items.length - 1)),
	);
	/** 新しいコンテキスト追加要求だけを現在の選択位置で開き、同じ要求を繰り返し処理しない。 */
	function openRequestedContext() {
		const request = props.contextRequest;
		if (request === lastRequest) {
			return;
		}
		lastRequest = request;
		match = editor.getEditorState().read(buttonCompletion);
		source = "button";
		category = "";
		search = "";
		selected = 0;
	}
	// 外部からの Context 要求を Lexical の選択位置へ接続し、要求番号ごとに一度だけ開く。
	$effect(openRequestedContext);
	/** 閉じたときの入力位置を記録し、同じ位置の補完をすぐに再表示しない。 */
	function close() {
		dismissed.current = JSON.stringify(
			editor.getEditorState().read(completion),
		);
		match = null;
	}
	/** ディレクトリの親またはカテゴリー一覧へ戻り、検索語と候補の選択位置を初期化する。 */
	function back() {
		if (candidates.browsing && candidates.paths.hasParent) {
			candidates.paths.back();
		} else {
			category = "";
		}
		search = "";
		selected = 0;
	}
	/** 入力中の補完起点を取り除いて候補を閉じ、親へ添付ファイルの選択を要求する。 */
	function addAttachment() {
		if (!props.onAttach) {
			return;
		}
		const current = match;
		if (current && source === "inline") {
			editor.update(() => insertCompletion(current, ""));
		}
		close();
		props.onAttach();
		return;
	}
	/** 候補の種類に応じて階層を移動し、候補を追加取得または本文へ挿入する。無効な候補は選ばない。 */
	function pick(item: CompletionItem) {
		if (item.disabled === true) {
			return;
		}
		if (item.category === "添付ファイル") {
			addAttachment();
			return;
		}
		if (item.more === true) {
			candidates.sessions.more();
			return;
		}
		if (item.directory) {
			candidates.paths.open(item.directory);
			search = "";
			selected = 0;
			return;
		}
		if (item.category !== undefined && item.category !== "") {
			candidates.paths.reset();
			category = item.category;
			search = "";
			selected = 0;
			return;
		}
		const current = match;
		const text = item.text;
		if (!current || text === undefined) {
			return;
		}
		editor.update(() => insertCompletion(current, text, item.reference));
		if (item.reference) {
			recent = [
				item,
				...recent.filter(
					(entry) =>
						JSON.stringify(entry.reference) !==
						JSON.stringify(item.reference),
				),
			].slice(0, 5);
		}
		match = null;
		editor.focus();
	}
	/** 現在の補完状態を共通のキー処理へ渡し、選択位置と確定操作を候補表示へ反映する。 */
	function handleKey(event: KeyboardEvent, inSearch = false) {
		return handleCompletionKey(
			event,
			{
				editor,
				match,
				category,
				items: candidates.items,
				index,
				close,
				back,
				pick,
				setSelected: (value) => {
					selected = value;
				},
			},
			inSearch,
		);
	}
	/** 入力位置の変化を補完へ反映し、起点が移動した場合は以前のカテゴリーを引き継がない。 */
	function onMatch(next: Completion | null) {
		const moved =
			next?.marker !== match?.marker ||
			next?.key !== match?.key ||
			next?.start !== match?.start;
		if (moved) {
			category = "";
		}
		source = "inline";
		match = next;
		search = null;
		selected = 0;
	}
	useCompletionEditor(editor, {
		get match() {
			return match;
		},
		dismissed,
		container: containerRef,
		handleKey,
		id,
		get selected() {
			return candidates.items[index] ? index : null;
		},
		onMatch,
	});
	/** 参照の階層と検索を初期化してカテゴリー一覧へ戻す。 */
	function categories() {
		candidates.paths.reset();
		category = "";
		search = "";
		selected = 0;
	}
	/** 指定した祖先ディレクトリへ移動し、新しい一覧の先頭から選択する。 */
	function ancestor(depth: number) {
		candidates.paths.goTo(depth);
		search = "";
		selected = 0;
	}
	/** 検索欄で処理した補完のキー操作を、外側の入力欄へ伝播させない。 */
	function searchKey(event: KeyboardEvent) {
		if (handleKey(event, true)) {
			event.stopPropagation();
		}
	}
	/** 候補パネル内では閉じる・戻る操作だけを受け取り、他のキー操作は各項目に任せる。 */
	function panelKey(event: KeyboardEvent) {
		const dismissKey =
			event.key === "Escape" ||
			(event.altKey && event.key === "ArrowLeft");
		if (dismissKey && handleKey(event, true)) {
			event.stopPropagation();
		}
	}
	/** 補完の検索語を更新し、絞り込んだ候補の先頭へ選択を戻す。 */
	function setSearch(value: string) {
		search = value;
		selected = 0;
	}
</script>

{#if match}
	<div bind:this={container} role="presentation" onkeydown={panelKey}>
		{#if match.marker === "#"}
			<ContextPicker
				{id}
				{title}
				{query}
				items={candidates.items}
				selected={index}
				autoFocus={source === "button"}
				location={candidates.browsing
					? candidates.paths.path
					: undefined}
				notice={candidates.notice}
				empty={candidates.empty}
				{recent}
				ancestors={candidates.paths.ancestors}
				onAncestor={ancestor}
				onCategories={categories}
				onQuery={setSearch}
				onKeyDown={searchKey}
				onPick={pick}
			/>
		{:else}
			<CompletionMenu
				{id}
				{title}
				{query}
				items={candidates.items}
				selected={index}
				autoFocus={source === "button"}
				location={candidates.browsing
					? candidates.paths.path
					: undefined}
				notice={candidates.notice}
				empty={candidates.empty}
				onQuery={setSearch}
				onKeyDown={searchKey}
				onPick={pick}
			/>
		{/if}
	</div>
{/if}

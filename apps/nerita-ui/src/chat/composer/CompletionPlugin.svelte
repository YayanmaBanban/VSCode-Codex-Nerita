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
	function close() {
		dismissed.current = JSON.stringify(
			editor.getEditorState().read(completion),
		);
		match = null;
	}
	function back() {
		if (candidates.browsing && candidates.paths.hasParent) {
			candidates.paths.back();
		} else {
			category = "";
		}
		search = "";
		selected = 0;
	}
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
	function categories() {
		candidates.paths.reset();
		category = "";
		search = "";
		selected = 0;
	}
	function ancestor(depth: number) {
		candidates.paths.goTo(depth);
		search = "";
		selected = 0;
	}
	function searchKey(event: KeyboardEvent) {
		if (handleKey(event, true)) {
			event.stopPropagation();
		}
	}
	function panelKey(event: KeyboardEvent) {
		const dismissKey =
			event.key === "Escape" ||
			(event.altKey && event.key === "ArrowLeft");
		if (dismissKey && handleKey(event, true)) {
			event.stopPropagation();
		}
	}
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

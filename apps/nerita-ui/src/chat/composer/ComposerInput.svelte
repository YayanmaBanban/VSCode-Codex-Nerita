<!-- Lexical の入力欄へ補完・参照・貼り付けの処理を組み込み、本文の変更と送信操作を親へ伝える。 -->
<script lang="ts">
	import { AutoLinkNode, LinkNode } from "@lexical/link";
	import type { Bridge } from "@nerita/shared/bridge";
	import type { Attachment } from "@nerita/shared/composer";
	import type { ComposerPart } from "@nerita/shared/composerContent";
	import type { SkillSummary } from "@nerita/shared/skills";
	import { cn } from "cnfast";
	import Maximize2 from "@lucide/svelte/icons/maximize-2";
	import Minimize2 from "@lucide/svelte/icons/minimize-2";
	import Tooltip from "../../ui/Tooltip.svelte";
	import LexicalComposer from "./LexicalComposer.svelte";
	import LexicalEditable from "./LexicalEditable.svelte";
	import CodeBlockMenuPlugin from "./CodeBlockMenuPlugin.svelte";
	import CompletionPlugin from "./CompletionPlugin.svelte";
	import ComposerLinksPlugin from "./ComposerLinksPlugin.svelte";
	import ComposerTooltipsPlugin from "./ComposerTooltipsPlugin.svelte";
	import ComposerPlugin from "./ComposerPlugin.svelte";
	import { $writeParts as writeParts } from "./content";
	import { PastedBlockNode } from "./PastedBlockNode";
	import { PathReferenceNode } from "./PathReferenceNode";
	import ReferenceActionsPlugin from "./ReferenceActionsPlugin.svelte";

	let props: {
		bridge?: Bridge | undefined;
		parts: ComposerPart[];
		onChange: (parts: ComposerPart[]) => void;
		onSubmit: () => void;
		locked?: boolean;
		followUp?: boolean;
		attachments?: Attachment[];
		skills?: SkillSummary[];
		completionScope?: string;
		collaborationModes?: boolean;
		contextRequest?: number | undefined;
		onAttach?: (() => void) | undefined;
	} = $props();
	let error = $state("");
	let expanded = $state(false);
	let showHelp = $state(false);
	let input: HTMLDivElement | undefined = $state();
	let empty = $derived(props.parts.every((part) => part.text === ""));
	const inputId = $props.id();
	const helpId = `${inputId}-help`;
	const config = {
		namespace: "codex-composer",
		nodes: [PastedBlockNode, PathReferenceNode, LinkNode, AutoLinkNode],
		theme: {
			link: "cursor-text text-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-focus",
			paragraph:
				"m-0 min-h-[1.7em] whitespace-pre-wrap [overflow-wrap:anywhere]",
		},
		onError: (cause: Error) => {
			throw cause;
		},
	};
	/** 入力欄のフォーカスを外してから、親へ送信を要求する。 */
	function submit() {
		input?.blur();
		props.onSubmit();
	}
</script>

<LexicalComposer {config} initialize={() => writeParts(props.parts)}>
	<div class="flex items-start gap-2">
		<div class="relative min-w-0 flex-1">
			{#key props.completionScope ?? ""}
				<CompletionPlugin
					{...props}
					attachments={props.attachments ?? []}
					skills={props.skills ?? []}
				/>
			{/key}
			<LexicalEditable
				bind:element={input}
				id={inputId}
				aria-label="Codexへのメッセージ"
				aria-describedby={helpId}
				disabled={props.locked ?? false}
				aria-disabled={props.locked ?? false}
				spellcheck={false}
				onfocus={() => {
					showHelp = true;
				}}
				onblur={() => {
					showHelp = false;
				}}
				onkeydown={(event: KeyboardEvent) => {
					if (event.key === "Escape") {
						showHelp = false;
					}
				}}
				class={cn(
					"composer-content min-h-[65px] overflow-y-auto overscroll-y-contain p-1",
					"[scrollbar-width:thin] leading-[1.7] text-input-text",
					"focus-visible:outline-2 focus-visible:outline-focus",
					expanded
						? "h-[min(65dvh,calc(100dvh-300px))]"
						: "max-h-[min(360px,45vh)]",
				)}
			/>
			{#if empty}
				<span
					class="pointer-events-none absolute top-1 left-1 text-input-placeholder"
				>
					{props.followUp === true
						? "フォローアップを送信"
						: "チャットを送信"}
				</span>
			{/if}
			<span
				id={helpId}
				role="tooltip"
				hidden={!showHelp}
				class={cn(
					"absolute bottom-full left-0 z-30 mb-2 w-max max-w-full rounded-[6px] border border-solid",
					"border-tooltip-border bg-tooltip px-3 py-2 text-[12px] leading-[1.5] text-tooltip-text",
					"shadow-[0_4px_16px_#0003]",
				)}
			>
				Ctrl+Enter で送信・Enter / Shift+Enter で改行・Shift +
				ドロップでファイル添付
			</span>
		</div>
		<Tooltip
			content={expanded
				? "入力エリアを元のサイズに戻す"
				: "入力エリアを拡張"}
		>
			{#snippet children({ props: triggerProps })}
				<button
					{...triggerProps}
					type="button"
					class="flex h-7 w-7 shrink-0 items-center justify-center border-0 bg-transparent p-1 text-muted hover:text-input-text"
					aria-label={expanded
						? "入力エリアを元のサイズに戻す"
						: "入力エリアを拡張"}
					aria-expanded={expanded}
					aria-controls={inputId}
					onmousedown={(event) => event.preventDefault()}
					onclick={() => {
						expanded = !expanded;
					}}
				>
					{#if expanded}
						<Minimize2 size={16} aria-hidden="true" />
					{:else}
						<Maximize2 size={16} aria-hidden="true" />
					{/if}
				</button>
			{/snippet}
		</Tooltip>
	</div>
	<ComposerLinksPlugin />
	<ComposerTooltipsPlugin />
	<CodeBlockMenuPlugin bridge={props.bridge} />
	<ReferenceActionsPlugin bridge={props.bridge} />
	<ComposerPlugin
		{...props}
		onError={(message: string) => {
			error = message;
		}}
		onSubmit={submit}
	/>
	{#if error !== ""}
		<p role="alert" class="text-[12px] text-tool-error">
			{error}
		</p>
	{/if}
</LexicalComposer>

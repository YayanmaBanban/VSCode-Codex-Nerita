<!-- 性格設定の指示を Lexical の入力欄で編集し、本文の変更を親へ通知する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import {
		$getRoot as getRoot,
		$createParagraphNode as createParagraphNode,
		$createTextNode as createTextNode,
	} from "lexical";
	import LexicalComposer from "../composer/LexicalComposer.svelte";
	import LexicalEditable from "../composer/LexicalEditable.svelte";
	import InstructionChanges from "./InstructionChanges.svelte";

	let {
		text,
		disabled,
		label,
		onChange,
	}: {
		text: string;
		disabled: boolean;
		label: string;
		onChange: (text: string) => void;
	} = $props();
	const helpId = $props.id();
	const config = {
		namespace: "personality",
		theme: {
			paragraph:
				"m-0 min-h-[1.7em] whitespace-pre-wrap [overflow-wrap:anywhere]",
		},
		onError: (error: Error) => {
			throw error;
		},
	};
</script>

<div class="min-w-0">
	<LexicalComposer
		{config}
		initialize={() => {
			getRoot().append(
				createParagraphNode().append(createTextNode(text)),
			);
		}}
	>
		<LexicalEditable
			{disabled}
			aria-label={label}
			aria-describedby={helpId}
			aria-readonly={disabled}
			class={cn(
				"max-h-[240px] min-h-[120px] overflow-y-auto rounded-[6px] border border-solid border-input-border",
				"bg-input p-[10px] leading-[1.7] text-input-text",
				"focus-visible:outline-2 focus-visible:outline-focus",
			)}
		/>
		<InstructionChanges {onChange} />
	</LexicalComposer>
	<p id={helpId} class="mt-[6px] mb-0 text-[12px] leading-[1.7] text-muted">
		ルールや性格を記載する場所です。使用させたいコマンドなどは、AGENTS.md
		に記載してください。
	</p>
</div>

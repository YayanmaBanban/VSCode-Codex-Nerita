<script lang="ts">
	// カスタムレンダラーの編集 DOM と Markdown の source が同期する範囲を確かめる。
	import SvelteMarkdown, {
		type ParagraphSnippetProps,
	} from "@humanspeak/svelte-markdown";

	let markdownSource = $state("最初の下書き");
</script>

<SvelteMarkdown source={markdownSource}>
	{#snippet paragraph({ children }: ParagraphSnippetProps)}
		<div
			contenteditable="true"
			role="textbox"
			aria-label="レンダラー内の入力欄"
			aria-multiline="true"
			tabindex="0"
		>
			{@render children?.()}
		</div>
	{/snippet}
</SvelteMarkdown>
<output data-testid="markdown-source">{markdownSource}</output>
<button
	type="button"
	onclick={() => {
		markdownSource = "外部から復元した下書き";
	}}
>
	source を変更
</button>

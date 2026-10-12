<!-- Markdown と累積ストリームを描画し、検証済み参照と安全なリンクだけを操作にする。 -->
<script lang="ts">
	import SvelteMarkdown, {
		buildUnsupportedHTML,
		UnsupportedHTML,
		type TextSnippetProps,
		type RawTextSnippetProps,
		type CodespanSnippetProps,
		type CodeSnippetProps,
		type TableSnippetProps,
		type ImageSnippetProps,
		type LinkSnippetProps,
		type ListItemSnippetProps,
	} from "@humanspeak/svelte-markdown";
	import type { UiMessage } from "@nerita/shared/messages";
	import {
		pathText,
		type ComposerReference,
	} from "@nerita/shared/composerReferences";
	import { cn } from "cnfast";
	import { messageReferences } from "./messageReferences";
	import ReferenceText from "./ReferenceText.svelte";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";

	let {
		text,
		send,
		references = [],
		streaming = false,
		streamId,
	}: {
		text: string;
		send?: ((message: UiMessage) => void) | undefined;
		references?: ComposerReference[] | undefined;
		streaming?: boolean;
		streamId?: string | undefined;
	} = $props();

	const options = { gfm: true, breaks: true, headerIds: false };
	// 生 HTML は旧描画と同じく文字として扱い、外部画像の取得を認めない。
	const content = $derived(messageReferences(text, references));
	const renderers = $derived({ html: escapedHtmlRenderers(content.text) });
	const markdownStyle = cn(
		"message-markdown min-w-0 [overflow-wrap:anywhere] whitespace-normal [&>:first-child]:mt-0 [&>:last-child]:mb-0",
		"[&_h1]:my-[16px] [&_h1]:text-[20px] [&_h2]:my-[14px] [&_h2]:text-[17px] [&_h3]:my-[12px] [&_h3]:text-[15px]",
		"[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold [&_p]:my-[10px]",
		"[&_li]:my-[4px] [&_li>p]:my-[4px] [&_ol]:my-[8px] [&_ol]:list-decimal [&_ol]:pl-[22px] [&_ul]:my-[8px] [&_ul]:list-disc [&_ul]:pl-[22px]",
		"[&_blockquote]:my-[12px] [&_blockquote]:border-l-2 [&_blockquote]:border-panel-border [&_blockquote]:pl-[12px] [&_blockquote]:text-muted",
		"[&_code]:rounded-[3px] [&_code]:bg-message-code [&_code]:px-[3px] [&_code]:font-mono [&_code]:text-[12px] [&_pre_code]:p-0",
		"[&_td]:border [&_td]:border-panel-border [&_td]:px-[8px] [&_td]:py-[5px] [&_th]:border [&_th]:border-panel-border [&_th]:px-[8px] [&_th]:py-[5px]",
		"[&_.task-list-item]:list-none [&_hr]:my-[16px] [&_hr]:border-panel-border [&_input]:mr-[6px]",
	);

	/** ライブラリの既知タグ以外も、出力に現れる全タグを文字列として描画する。 */
	function escapedHtmlRenderers(source: string) {
		const html = buildUnsupportedHTML();
		for (const match of source.matchAll(/<\/?([a-z][a-z0-9:-]*)\b/gi)) {
			html[match[1]!.toLowerCase()] = UnsupportedHTML;
		}
		return html;
	}

	/** URL の中の参照識別子はチップ化せず、元の表示文字を戻す。 */
	function restoreReferences(value: string) {
		let restored = value;
		for (const [token, target] of content.targets) {
			restored = restored.replaceAll(token, pathText(target));
		}
		return restored;
	}

	/** ローカルパスを URI にし、実行可能な URL プロトコルを拒否する。 */
	function markdownUrl(value: string) {
		const url = restoreReferences(value);
		if (/^[a-z]:[\\/]/i.test(url)) {
			return `file:///${url.replaceAll("\\", "/")}`;
		}
		if (/^\/(?!\/)/.test(url)) {
			return `file://${url}`;
		}
		if (/^file:\/\//i.test(url)) {
			return url;
		}
		// 制御文字やエンティティを使う難読化はライブラリの既定検証にも渡さず拒否する。
		const controlCharacter = Array.from(url.split(":")[0] ?? "").some(
			(character) =>
				character.charCodeAt(0) <= 32 ||
				character.charCodeAt(0) === 127,
		);
		if (controlCharacter) {
			return "";
		}
		const protocol = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
		return isNonEmptyString(protocol) &&
			!["http", "https", "mailto", "irc", "ircs", "xmpp"].includes(
				protocol,
			)
			? ""
			: url;
	}
</script>

<div class={markdownStyle}>
	<SvelteMarkdown
		source={content.text}
		{streaming}
		{...streamId === undefined ? {} : { streamId }}
		{options}
		{renderers}
		sanitizeUrl={markdownUrl}
	>
		{#snippet text({ text: value = "", children }: TextSnippetProps)}
			{#if children}{@render children()}{:else}<ReferenceText
					{value}
					targets={content.targets}
					{send}
				/>{/if}
		{/snippet}
		{#snippet rawtext({ text: value }: RawTextSnippetProps)}<ReferenceText
				{value}
				targets={content.targets}
				{send}
			/>{/snippet}
		{#snippet codespan({ text: value = "" }: CodespanSnippetProps)}<code
				><ReferenceText
					{value}
					targets={content.targets}
					{send}
				/></code
			>{/snippet}
		{#snippet code({ text: value, lang }: CodeSnippetProps)}
			<pre
				class="my-[12px] overflow-x-auto rounded-[6px] bg-message-code p-[12px] text-[12px] whitespace-pre"><code
					class={isNonEmptyString(lang)
						? `language-${lang}`
						: undefined}
					><ReferenceText
						{value}
						targets={content.targets}
						{send}
					/></code
				></pre>
		{/snippet}
		{#snippet table({ children }: TableSnippetProps)}
			<div class="my-[12px] max-w-full overflow-x-auto">
				<table class="w-full border-collapse text-left text-[12px]">
					{@render children?.()}
				</table>
			</div>
		{/snippet}
		{#snippet listitem({ task, checked, children }: ListItemSnippetProps)}
			<li class={task === true ? "task-list-item" : undefined}>
				{#if task === true}<input
						type="checkbox"
						disabled
						checked={checked === true}
						aria-label="タスクの完了状態"
					/>{/if}
				{@render children?.()}
			</li>
		{/snippet}
		{#snippet image({ text: alt }: ImageSnippetProps)}<span
				>{restoreReferences(isNonEmptyString(alt) ? alt : "画像")}</span
			>{/snippet}
		{#snippet link({ href = "", title, children }: LinkSnippetProps)}
			{@const local = /^file:\/\//i.test(href)}
			<a
				href={isNonEmptyString(href) ? href : undefined}
				title={isNonEmptyString(title)
					? restoreReferences(title)
					: undefined}
				target={local ? undefined : "_blank"}
				rel="noreferrer noopener"
				class="text-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-focus"
				onclick={(event) => {
					if (local && isNonEmptyString(href)) {
						event.preventDefault();
						send?.({
							type: "reference/open",
							requestId: crypto.randomUUID(),
							uri: href,
						});
					}
				}}
			>
				{@render children?.()}
			</a>
		{/snippet}
	</SvelteMarkdown>
</div>

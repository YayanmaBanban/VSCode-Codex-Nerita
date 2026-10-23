<script lang="ts">
	// 本体と同じ Markdown 表示で、外部データと累積ストリームを検証する。
	import MessageText from "../../src/chat/messages/MessageText.svelte";
	import { unsafeMarkdown } from "./markdownOutputFixture";

	let { mode }: { mode: "security" | "stream" } = $props();
	let text = $state("先頭 👩‍💻\n\n```ts\nconst answer =");
	let streaming = $state(true);
	let streamId = $state("first");
	/** 累積本文にコード・GFM 表・改行を追加する。 */
	function append() {
		text +=
			" 42;\n```\n\n| 項目 | 値 |\n| --- | --- |\n| 結果 | ✅ |\n\n一行\n二行";
	}
	/** 同じ ID でも累積本文が書き換わった場合を再現する。 */
	function rewrite() {
		text = "本文を修正した 🧑‍🔧";
	}
	/** 仮想行が別のメッセージへ再利用された場合を再現する。 */
	function replaceMessage() {
		streamId = "second";
		text = "次のメッセージ 👨‍👩‍👧‍👦";
	}
</script>

{#if mode === "security"}
	<div data-testid="output">
		<MessageText text={unsafeMarkdown} />
	</div>
{:else}
	<div data-testid="output">
		<MessageText {text} {streaming} {streamId} />
	</div>
	<button type="button" onclick={append}>追記</button>
	<button type="button" onclick={rewrite}>本文を修正</button>
	<button type="button" onclick={replaceMessage}>次のメッセージ</button>
	<button
		type="button"
		onclick={() => {
			streaming = false;
		}}>確定</button
	>
{/if}

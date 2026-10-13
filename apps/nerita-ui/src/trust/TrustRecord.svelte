<script lang="ts">
	// フォルダーの信頼状態と登録元を表示し、信頼の変更・記録の削除を要求する。

	import "../chat/chat.css";

	import {
		buttonStyle,
		origins,
		type TrustRecordProps,
	} from "./TrustManagerParts";

	let { record, busy, send }: TrustRecordProps = $props();
</script>

<article class="grid gap-3 rounded-md border border-input-border p-4">
	<div class="flex flex-wrap items-center gap-2 text-sm">
		<strong>{record.trust === "trusted" ? "信頼済み" : "未信頼"}</strong
		><span class="text-muted">{origins[record.origin]}</span>
	</div>
	<h2 class="m-0 font-mono text-sm font-normal break-all">
		{record.root}
	</h2>
	<p class="m-0 text-xs text-muted">
		更新: {new Date(record.updatedAt).toLocaleString("ja-JP")}
	</p>
	<div class="flex flex-wrap gap-2">
		<button
			class={buttonStyle}
			disabled={busy || record.origin === "external-cache"}
			onclick={() =>
				send({
					type: record.trust === "trusted" ? "revoke" : "trust",
					root: record.root,
				})}
			>{record.trust === "trusted"
				? "信頼を取り消す"
				: "信頼する"}</button
		><button
			class={buttonStyle}
			disabled={busy}
			onclick={() => send({ type: "remove", root: record.root })}
			>記録を削除
		</button>
	</div>
</article>

<script lang="ts">
	// 信頼記録の追加・再取得を要求し、記録の削除でファイルは消えないことを説明する。

	import "../chat/chat.css";

	import {
		buttonStyle,
		type TrustManagerHeaderProps,
	} from "./TrustManagerParts";

	let { busy, send }: TrustManagerHeaderProps = $props();
</script>

<header class="grid gap-3">
	<h1 class="m-0 text-xl font-semibold">ワークスペースの信頼</h1>
	<p class="m-0 text-sm text-muted">
		Pi
		が利用するフォルダーの信頼状態を管理します。記録を削除しても、フォルダーやファイルは残ります。
	</p>
	<div class="flex flex-wrap gap-2">
		<button
			class={buttonStyle}
			disabled={busy}
			onclick={() => send({ type: "add" })}
			>フォルダーを追加
		</button><button
			class={buttonStyle}
			disabled={busy}
			onclick={() => send({ type: "refresh" })}
			>再読み込み
		</button>
	</div>
</header>

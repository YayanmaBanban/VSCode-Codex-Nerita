<script lang="ts">
	// 編集対象の値と操作を、親の文書状態から受け取る。

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

<!-- 文書の保存と実行への適用を1つのボタンで要求し、処理中は操作を無効にする。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import { buttonStyle } from "./fields";

	let { busy, onSave }: { busy: boolean; onSave: () => void } = $props();
</script>

<button
	class={cn(
		buttonStyle,
		"relative overflow-hidden border-focus bg-primary text-primary-text",
	)}
	aria-label="保存して適用"
	disabled={busy}
	onclick={onSave}
>
	保存して適用
</button>

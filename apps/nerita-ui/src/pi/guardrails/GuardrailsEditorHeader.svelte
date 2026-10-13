<!-- 文書の保存状態を表示し、保存と実行への適用を別の操作として要求する。 -->
<script lang="ts">
	import { cn } from "cnfast";

	import "../../chat/chat.css";

	import "./guardrails.css";

	import { buttonStyle } from "./fields";

	import GuardrailsSaveButton from "./GuardrailsSaveButton.svelte";

	import { type GuardrailsEditorHeaderProps } from "./GuardrailsEditorParts";

	let { editor, state, status, probe }: GuardrailsEditorHeaderProps =
		$props();
</script>

<header class="guardrails-header">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="m-0 text-xl font-semibold">Pi ガードレール</h1>
	</div>
	<p class="mb-0 text-[12px] break-all text-muted">
		{state.root}/ .pi/guardrails.json
	</p>
	<p class="m-0 text-[13px] text-muted">
		保存した設定は「適用」で実行に反映します。検査ではファイル操作やコマンドを実行しません。
	</p>
	<div class="flex flex-wrap gap-2">
		<GuardrailsSaveButton
			dirty={status === "未保存"}
			busy={editor.busy}
			onSave={() => editor.request("save", probe)}
		/><button
			class={cn(buttonStyle, "border-focus")}
			disabled={editor.busy || state.dirty}
			onclick={() => editor.request("apply", probe)}
			>適用
		</button>
	</div>
</header>

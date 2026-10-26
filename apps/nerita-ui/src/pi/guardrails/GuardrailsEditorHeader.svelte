<!-- 文書の保存・適用状態を表示し、保存と実行への適用をまとめて要求する。 -->
<script lang="ts">
	import { cn } from "cnfast";

	import "../../chat/chat.css";

	import "./guardrails.css";

	import GuardrailsSaveButton from "./GuardrailsSaveButton.svelte";
	import HelpButton from "../../ui/HelpButton.svelte";

	import { type GuardrailsEditorHeaderProps } from "./GuardrailsEditorParts";

	let { editor, state, status, probe }: GuardrailsEditorHeaderProps =
		$props();
</script>

<header class="guardrails-header">
	<div class="flex flex-wrap items-center gap-2">
		<h1 class="m-0 text-xl font-semibold">Pi ガードレール</h1>
		<HelpButton
			label="ガードレール設定のヘルプ"
			content={`${state.root}/.pi/guardrails.json\n設定を適用すると、変更前の承認は失効します。ファイルの外部変更は自動適用しません。検査ではファイル操作やコマンドを実行しません。`}
		/>
		<div class="flex flex-wrap gap-2" role="status">
			<span
				class={cn(
					"rounded border border-panel-border px-2 py-1 text-[12px]",
					status === "未保存" ? "text-warning" : "text-muted",
				)}>{status === "未保存" ? "● 未保存" : "保存済み"}</span
			>
			<span
				class="rounded border border-panel-border px-2 py-1 text-[12px] text-muted"
				>{status === "適用済み" ? "● 適用済み" : "● 未適用"}</span
			>
		</div>
	</div>
	<div class="flex shrink-0 flex-wrap gap-2">
		<GuardrailsSaveButton
			dirty={status === "未保存"}
			busy={editor.busy}
			onSave={() => editor.request("save", probe)}
		/>
	</div>
</header>

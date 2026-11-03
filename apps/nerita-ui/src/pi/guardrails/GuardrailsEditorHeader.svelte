<!-- ガードレール画面のタイトルと設定ファイルのヘルプを表示する。 -->
<script lang="ts">
	import "../../chat/chat.css";

	import "./guardrails.css";

	import HelpButton from "../../ui/HelpButton.svelte";

	import { type GuardrailsEditorHeaderProps } from "./GuardrailsEditorParts";

	let { state }: GuardrailsEditorHeaderProps = $props();
</script>

<header class="guardrails-header">
	<div class="flex flex-wrap items-center gap-2">
		<h1 class="m-0 text-xl font-semibold">Pi ガードレール</h1>
		<HelpButton
			label="ガードレール設定のヘルプ"
			content={`${state.root}/.pi/guardrails.json\n設定を適用すると、変更前の承認は失効します。ファイルの外部変更は自動適用しません。検査ではファイル操作やコマンドを実行しません。`}
		/>
	</div>
</header>

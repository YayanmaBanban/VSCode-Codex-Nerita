<script lang="ts">
	// 編集対象の値と操作を、親の文書状態から受け取る。

	import { cn } from "cnfast";

	import "../../chat/chat.css";

	import "./guardrails.css";

	import GuardrailsFeedback from "./GuardrailsFeedback.svelte";

	import { buttonStyle, inputStyle } from "./fields";

	import { type GuardrailsProbePaneProps } from "./GuardrailsEditorParts";

	import GuardrailsProbeTarget from "./GuardrailsProbeTarget.svelte";

	let { editor, probe, setProbe }: GuardrailsProbePaneProps = $props();
</script>

<section
	class="guardrails-pane guardrails-simulation"
	aria-label="判定シミュレーション"
>
	<div class="guardrails-pane-heading">
		<h2 class="m-0 text-[14px]">判定シミュレーション</h2>
		<button
			class={buttonStyle}
			disabled={editor.busy}
			onclick={() => editor.request("check", probe)}
			>検査
		</button>
	</div>
	<div class="guardrails-scroll flex flex-col gap-3">
		<GuardrailsProbeTarget {...{ probe, setProbe }} /><label
			>対象パス / コマンド
			<textarea
				class={cn(inputStyle, "min-h-20 resize-y font-editor")}
				value={probe.input}
				maxlength={32768}
				oninput={(event) =>
					setProbe({
						...probe,
						input: event.currentTarget.value,
					})}></textarea></label
		>
		<p class="m-0 text-[12px] text-muted">
			Shellの動的なパスやスクリプト内部は完全には解析できません。判定不能な範囲は承認時にも表示します。
		</p>
		<GuardrailsFeedback reply={editor.reply} />
	</div>
</section>

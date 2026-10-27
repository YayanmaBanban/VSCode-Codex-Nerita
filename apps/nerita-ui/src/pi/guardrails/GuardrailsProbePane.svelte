<!-- 検査対象の入力と Host の判定結果を表示し、ファイル操作やコマンドの実行は要求しない。 -->
<script lang="ts">
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
	</div>
	<div class="guardrails-scroll flex flex-col gap-3">
		<p class="m-0 text-muted">
			指定したパスやコマンドがルールに一致するかを検査します。
		</p>
		<GuardrailsProbeTarget {...{ probe, setProbe }} />
		<label
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
		<button
			class={cn(buttonStyle, "self-start bg-primary text-primary-text")}
			disabled={editor.busy}
			onclick={() => editor.request("check", probe)}
		>
			検査
		</button>
		<p class="m-0 text-[12px] text-muted">
			シェルの動的なパスやスクリプト内部は完全には解析できません。判定不能な範囲は承認時にも表示します。
		</p>
		{#if editor.reply?.result}
			<GuardrailsFeedback reply={editor.reply} />
		{/if}
	</div>
</section>

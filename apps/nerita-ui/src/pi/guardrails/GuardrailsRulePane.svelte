<script lang="ts">
	// ルールのフォーム編集と JSON 編集を切り替え、未送信入力が競合した場合は破棄操作を表示する。

	import { cn } from "cnfast";

	import "../../chat/chat.css";

	import "./guardrails.css";

	import GuardrailsRules from "./GuardrailsRules.svelte";

	import { buttonStyle, inputStyle } from "./fields";

	import { type GuardrailsRulePaneProps } from "./GuardrailsEditorParts";

	let { tab, setTab, editor, parsed }: GuardrailsRulePaneProps = $props();
</script>

<section class="guardrails-pane" aria-label="ルール設定">
	<div class="guardrails-pane-heading">
		<div class="flex items-center gap-3">
			<span>ルール編集</span><button
				type="button"
				role="switch"
				aria-label="JSONで編集"
				aria-checked={tab === "json"}
				class="guardrails-mode-switch"
				onclick={() => setTab(tab === "form" ? "json" : "form")}
				><span></span></button
			><span>JSON</span>
		</div>
	</div>
	<div class="guardrails-scroll">
		<fieldset disabled={editor.locked} class="m-0 min-w-0 border-0 p-0">
			{#if tab === "form" && parsed?.success === true}
				<GuardrailsRules
					config={parsed.data}
					onChange={(config) =>
						editor.change(`${JSON.stringify(config, null, 2)}\n`)}
				/>
			{:else}
				<div class="flex flex-col gap-2">
					{#if tab === "form"}
						<p role="alert" class="m-0 text-warning">
							設定形式を確認してください。JSONを修正するとルール編集に戻れます。
						</p>
					{/if}<label for="guardrails-json">設定JSON</label><textarea
						id="guardrails-json"
						maxlength={131072}
						spellcheck={false}
						class={cn(
							inputStyle,
							"min-h-80 resize-y font-editor text-[12px]",
						)}
						value={editor.text}
						oninput={(event) =>
							editor.change(event.currentTarget.value)}
					></textarea>
				</div>
			{/if}
		</fieldset>
		{#if editor.conflict}
			<button
				class={cn(buttonStyle, "self-start")}
				onclick={editor.reload}
				>編集を破棄して再読込
			</button>
		{/if}
	</div>
</section>

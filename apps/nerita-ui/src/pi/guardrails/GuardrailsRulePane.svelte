<!-- ルールのフォーム編集と JSON 編集を切り替え、未送信入力が競合した場合は破棄操作を表示する。 -->
<script lang="ts">
	import { cn } from "cnfast";
	import { MediaQuery } from "svelte/reactivity";
	import TabBar from "../../ui/TabBar.svelte";
	import HelpButton from "../../ui/HelpButton.svelte";

	import "../../chat/chat.css";

	import "./guardrails.css";

	import GuardrailsRules from "./GuardrailsRules.svelte";

	import { buttonStyle, inputStyle } from "./fields";

	import { type GuardrailsRulePaneProps } from "./GuardrailsEditorParts";

	let { tab, setTab, editor, parsed }: GuardrailsRulePaneProps = $props();
	const wide = new MediaQuery("(min-width: 1000px)");
	const selection = $state({ path: 0, command: 0 });
	const descriptions = {
		json: undefined,
		overview: undefined,
		builtins: undefined,
		path: "ファイルパスに対する読み取り・書き込みの判定ルールを設定します。",
		command: "コマンドに対する判定ルールを設定します。",
		exceptions: "選択したパスルールの対象から除外するパスを設定します。",
	};
	let help = $derived(descriptions[tab]);
	let currentRule = $derived.by(() => {
		if (parsed?.success !== true) {
			return undefined;
		}
		if (tab === "path" || tab === "exceptions") {
			return parsed.data.pathRules[
				Math.min(selection.path, parsed.data.pathRules.length - 1)
			];
		}
		if (tab === "command") {
			return parsed.data.commandRules[
				Math.min(selection.command, parsed.data.commandRules.length - 1)
			];
		}
		return undefined;
	});
	let categories = $derived([
		{ value: "overview", label: "概要", count: undefined },
		{ value: "builtins", label: "組み込み", count: undefined },
		{
			value: "path",
			label: "パスルール",
			count:
				parsed?.success === true
					? parsed.data.pathRules.length
					: undefined,
		},
		{
			value: "command",
			label: "コマンドルール",
			count:
				parsed?.success === true
					? parsed.data.commandRules.length
					: undefined,
		},
		{
			value: "exceptions",
			label: "パス例外",
			count:
				parsed?.success === true
					? parsed.data.pathRules.reduce(
							(sum, rule) => sum + rule.exceptions.length,
							0,
						)
					: undefined,
		},
		{ value: "json", label: "JSON", count: undefined },
	] as const);
</script>

<section class="guardrails-pane" aria-label="ルール設定">
	<div class="guardrails-navigation">
		<h2 class="guardrails-pane-heading m-0 text-[14px]">ルール</h2>
		<TabBar
			label="ルールのカテゴリ"
			items={categories}
			value={tab}
			onChange={setTab}
			orientation={wide.current ? "vertical" : "horizontal"}
		/>
	</div>
	<div class="guardrails-edit-body">
		{#if help !== undefined}
			<div class="guardrails-pane-heading">
				<div class="flex min-w-0 items-center gap-2">
					{#if currentRule}
						<h2 class="m-0 min-w-0 text-[14px] break-all">
							{currentRule.id !== ""
								? currentRule.id
								: "ID未入力"}
						</h2>
					{/if}
					<HelpButton label="ルール設定のヘルプ" content={help} />
				</div>
			</div>
		{/if}
		<div class="guardrails-scroll">
			<fieldset disabled={editor.locked} class="m-0 min-w-0 border-0 p-0">
				{#if tab !== "json" && parsed?.success === true}
					<GuardrailsRules
						onEditExceptions={() => setTab("exceptions")}
						{selection}
						locked={editor.locked}
						section={tab}
						config={parsed.data}
						onChange={(config) =>
							editor.change(
								`${JSON.stringify(config, null, 2)}\n`,
							)}
					/>
				{:else}
					<div class="flex flex-col gap-2">
						{#if tab !== "json"}
							<p role="alert" class="m-0 text-warning">
								設定形式を確認してください。JSONを修正するとルール編集に戻れます。
							</p>
						{/if}
						<label for="guardrails-json">設定JSON</label>
						<textarea
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
	</div>
</section>

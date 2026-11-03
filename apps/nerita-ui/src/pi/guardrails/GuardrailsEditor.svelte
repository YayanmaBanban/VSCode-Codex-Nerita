<!-- ガードレールのフォームと判定シミュレーションを組み立て、文書の保存状態を共有する。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import TabBar from "../../ui/TabBar.svelte";
	import { type GuardProbe } from "@nerita/shared/guardrails/messages";

	import "../../chat/chat.css";
	import { guardrailsFormSchema } from "./formSchema";
	import "./guardrails.css";

	import { useGuardrails } from "./useGuardrails.svelte";

	let { bridge }: GuardrailsEditorProps = $props();
	const editor = useGuardrails(untrack(() => bridge));
	let tab = $state<
		"overview" | "builtins" | "path" | "command" | "exceptions"
	>("path");
	let pane = $state<"edit" | "simulation">("edit");
	let probe = $state.raw<GuardProbe>({
		tool: "read",
		input: ".env",
		cwd: ".",
	});

	let parsed = $derived.by(() => {
		try {
			return guardrailsFormSchema.safeParse(JSON.parse(editor.text));
		} catch {
			return undefined;
		}
	});
	let status = $derived(
		editor.state ? documentStatus(editor.text, editor.state) : "",
	);

	import {
		type GuardrailsEditorProps,
		documentStatus,
	} from "./GuardrailsEditorParts";
	import GuardrailsEditorHeader from "./GuardrailsEditorHeader.svelte";
	import GuardrailsProbePane from "./GuardrailsProbePane.svelte";

	import GuardrailsRulePane from "./GuardrailsRulePane.svelte";
	import GuardrailsEditorFooter from "./GuardrailsEditorFooter.svelte";
	/** 編集するルールの種類を切り替える。 */
	const setTab = (value: typeof tab) => {
		tab = value;
	};

	/** 判定シミュレーションに使うツール・作業ディレクトリ・入力を保持する。 */
	const setProbe = (value: GuardProbe) => {
		const changed =
			value.tool !== probe.tool ||
			value.cwd !== probe.cwd ||
			value.input !== probe.input;
		if (changed) {
			editor.invalidateProbe();
		}
		probe = value;
	};
</script>

{#if editor.state}
	<main
		class="guardrails-editor text-foreground"
		data-document-status={status}
	>
		<GuardrailsEditorHeader state={editor.state} />
		<div class="guardrails-mobile-tabs">
			<TabBar
				label="表示切替"
				value={pane}
				items={[
					{ value: "edit", label: "編集" },
					{ value: "simulation", label: "シミュレーション" },
				] as const}
				onChange={(value: "edit" | "simulation") => (pane = value)}
			/>
		</div>
		<div class="guardrails-panes" data-pane={pane}>
			<GuardrailsRulePane
				{...{
					tab,
					setTab,
					editor,
					parsed,
				}}
			/>
			<GuardrailsProbePane {...{ editor, probe, setProbe }} />
		</div>
		<GuardrailsEditorFooter
			{editor}
			state={editor.state}
			{status}
			{probe}
			formAvailable={parsed?.success === true}
		/>
	</main>
{:else}
	<p class="p-5">ガードレール設定を読み込み中…</p>
{/if}

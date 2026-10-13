<!-- グラフの編集内容を TOML と同期し、選択ステップと定義の検証結果を保持する。 -->
<script lang="ts">
	import { errorText } from "@nerita/shared/errorText";

	import {
		parseWorkflow,
		validateWorkflow,
		type Workflow,
	} from "@nerita/shared/workflows/definition";

	import { stringify } from "smol-toml";

	import { untrack } from "svelte";

	let { initial, text, change }: WorkflowGraphEditorProps = $props();
	let draft = $state.raw(
		untrack(() => ({ workflow: initial, written: text })),
	);
	let selected = $state(untrack(() => initial.steps[0]!.id));
	let error = $state("");
	let incoming = $derived.by(() => {
		const matchesText =
			draft.written.replaceAll("\r\n", "\n") ===
			text.replaceAll("\r\n", "\n");
		if (matchesText) {
			return { workflow: draft.workflow, invalid: false };
		}
		try {
			return { workflow: parseWorkflow(text), invalid: false };
		} catch {
			return { workflow: draft.workflow, invalid: true };
		}
	});
	let workflow = $derived(incoming.workflow);
	let externalInvalid = $derived(incoming.invalid);

	let step = $derived(
		workflow.steps.find((item) => item.id === selected) ??
			workflow.steps[0]!,
	);
	let validation = $derived.by(() => {
		try {
			validateWorkflow(workflow);
			return "";
		} catch (cause) {
			return errorText(cause);
		}
	});

	import { type WorkflowGraphEditorProps } from "./WorkflowGraphEditorParts";
	import WorkflowGraphPane from "./WorkflowGraphPane.svelte";
	import WorkflowInspector from "./WorkflowInspector.svelte";

	/** グラフの編集結果を TOML に変換し、下書きを更新して以前の操作エラーを消す。 */
	const update = (value: Workflow) => {
		const written = stringify(value);
		draft = { workflow: value, written };
		change(written);
		error = "";
	};

	/** グラフの編集操作を実行し、失敗した場合は設定欄にエラーを表示する。 */
	const attempt = (operation: () => void) => {
		try {
			operation();
		} catch (cause) {
			error = errorText(cause);
		}
	};

	/** 設定欄で編集するステップの ID を保持する。 */
	const setSelected = (value: string) => {
		selected = value;
	};
</script>

{#if externalInvalid}<p role="alert" class="p-4">
		文書がグラフで扱えない内容に更新されました。TOML
		編集に切り替えて修正してください。
	</p>{:else}
	<div class="workflow-graph-layout grid min-h-0 flex-1">
		<WorkflowGraphPane
			{...{
				workflow,
				update,
				setSelected,
				step,
				attempt,
			}}
		/><WorkflowInspector
			{...{
				workflow,
				update,
				step,
				attempt,
				setSelected,
				error,
				validation,
			}}
		/>
	</div>
{/if}

<!-- ステップのタスク・会話の継承・依存先・出力を編集し、変更を親へ伝える。 -->
<script lang="ts">
	import { untrack } from "svelte";

	let props: WorkflowStepFormProps = $props();
	let { step, workflow, change, rename, remove, output } = $derived(props);
	let id = $state(untrack(() => step.id));

	let mode = $derived(contextMode(step));
	let source = $derived(step.resume ?? step.fork ?? "");
	let switchMode = $derived(createContextModeChange(source, step, change));

	import {
		contextMode,
		type WorkflowStepFormProps,
		createContextModeChange,
	} from "./WorkflowStepFormParts";
	import WorkflowStepGroup from "./WorkflowStepGroup.svelte";
	import WorkflowContextSource from "./WorkflowContextSource.svelte";
	import WorkflowContextMode from "./WorkflowContextMode.svelte";
	import WorkflowDependencies from "./WorkflowDependencies.svelte";
	/** 名前変更を確定する前のステップ ID を入力欄に保持する。 */
	const setId = (value: string) => {
		id = value;
	};
</script>

<section class="flex min-w-0 flex-col gap-3" aria-label="ステップ設定">
	<div class="flex items-center justify-between gap-2">
		<h2 class="text-sm font-semibold">ステップ設定</h2>
		<button onclick={remove}>削除</button>
	</div>
	<label
		>ステップ ID
		<div class="flex gap-2">
			<input
				value={id}
				oninput={(event) => setId(event.currentTarget.value)}
			/><button onclick={() => rename(id)}>変更</button>
		</div></label
	><WorkflowContextMode
		{...{
			mode,
			switchMode,
			workflow,
			step,
		}}
	/>{#if mode !== "fresh"}
		<WorkflowContextSource
			{...{
				source,
				switchMode,
				mode,
				workflow,
				step,
			}}
		/>
	{/if}{#if mode !== "resume"}
		<label
			>Agent
			<input
				value={step.agent ?? ""}
				maxlength={80}
				oninput={(event) =>
					change({ ...step, agent: event.currentTarget.value })}
				placeholder="worker / reviewer"
			/></label
		>
	{/if}<label
		>タスク
		<textarea
			rows={7}
			value={step.task}
			maxlength={32768}
			oninput={(event) =>
				change({ ...step, task: event.currentTarget.value })}
			placeholder={"{{ step.output }} で依存先の結果を参照"}
		></textarea></label
	><WorkflowStepGroup {...{ step, change }} /><WorkflowDependencies
		{...{ ...props }}
	/><label class="workflow-check"
		><input
			type="checkbox"
			checked={workflow.outputs.includes(step.id)}
			oninput={(event) => output(event.currentTarget.checked)}
		/>ワークフローの出力に含める
	</label>
</section>

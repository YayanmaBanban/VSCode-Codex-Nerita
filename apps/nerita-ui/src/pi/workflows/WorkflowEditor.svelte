<!-- ワークフローのグラフ・TOML 編集を切り替え、保存・実行と Host の応答を共通の状態で扱う。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import { type WorkflowBridge } from "@nerita/shared/workflows/messages";
	import {
		parseWorkflow,
		type Workflow,
	} from "@nerita/shared/workflows/definition";
	import WorkflowGraphEditor from "./WorkflowGraphEditor.svelte";
	import { useWorkflow } from "./useWorkflow.svelte";
	import WorkflowToolbar from "./WorkflowToolbar.svelte";
	import WorkflowFeedback from "./WorkflowFeedback.svelte";
	import WorkflowError from "./WorkflowError.svelte";
	import "./workflows.css";

	/** 文書をグラフ用の定義へ解析し、解析できない間はグラフ編集を提供しない。 */
	function readGraph(text: string) {
		try {
			return parseWorkflow(text);
		} catch {
			return null;
		}
	}
	let { bridge }: { bridge: WorkflowBridge } = $props();
	const editor = useWorkflow(untrack(() => bridge));
	let mode = $state<"graph" | "toml">("graph");
	let initial = $state.raw<Workflow | null>(null);
	let generation = $state(0);
	let parsed = $derived(readGraph(editor.text));
	let graph = $derived(initial ?? parsed);
	let locked = $derived(editor.locked);
	/** グラフを再生成するときの初期定義を保持する。 */
	const setInitial = (value: Workflow | null) => {
		initial = value;
	};
	/** グラフの再生成を識別する世代を更新し、以前の編集部品を破棄する。 */
	const setGeneration = (change: (value: number) => number) => {
		generation = change(generation);
	};
	/** 解析済みの文書だけをグラフへ切り替え、再生成時は現在の定義を初期値にする。 */
	const switchMode = () => {
		if (mode === "graph") {
			mode = "toml";
		} else if (parsed) {
			initial = parsed;
			generation++;
			mode = "graph";
		}
	};
</script>

<main class="workflow-editor flex h-screen min-h-0 flex-col text-[13px]">
	<WorkflowToolbar
		{editor}
		{bridge}
		{mode}
		valid={!!parsed}
		{switchMode}
	/><WorkflowError
		error={editor.reply?.error}
		reload={() => {
			editor.reload();
			setInitial(readGraph(editor.state?.text ?? ""));
			setGeneration((value) => value + 1);
		}}
	/>{#if editor.state}
		<fieldset
			disabled={locked}
			inert={locked}
			class="flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0"
		>
			{#if mode === "graph" && graph}
				{#key generation}
					<WorkflowGraphEditor
						initial={graph}
						text={editor.text}
						change={(value: string) => {
							setInitial(graph);
							editor.change(value);
						}}
					/>
				{/key}
			{:else}
				<div class="flex min-h-0 flex-1 flex-col gap-2 p-4">
					{#if !parsed}
						<p role="status">
							TOML を修正するとグラフ編集を利用できます。
						</p>
					{/if}<label class="flex min-h-0 flex-1 flex-col gap-2"
						>Workflow TOML
						<textarea
							class="min-h-60 flex-1 font-mono"
							spellcheck={false}
							value={editor.text}
							maxlength={262144}
							oninput={(event) =>
								editor.change(event.currentTarget.value)}
						></textarea></label
					>
				</div>
			{/if}
		</fieldset>
	{/if}<WorkflowFeedback {editor} />
</main>

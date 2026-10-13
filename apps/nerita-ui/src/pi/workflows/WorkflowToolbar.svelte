<!-- ワークフローの編集方式と保存・検証・実行の操作を、文書の状態に合わせて提供する。 -->
<script lang="ts">
	import { type WorkflowBridge } from "@nerita/shared/workflows/messages";

	let {
		editor,
		bridge,
		mode,
		valid,
		switchMode,
	}: {
		editor: WorkflowEditorState;
		bridge: WorkflowBridge;
		mode: "graph" | "toml";
		valid: boolean;
		switchMode: () => void;
	} = $props();
	let disabled = $derived(editor.busy || editor.locked);
	let dirty = $derived(editor.state?.dirty === true);

	import { type WorkflowEditorState } from "./WorkflowToolbarParts";
	import WorkflowActions from "./WorkflowActions.svelte";
</script>

<header class="shrink-0 border-b border-[var(--workflow-border)] p-4">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="min-w-0">
			<h1 class="text-base font-semibold">Pi Workflow</h1>
			<p class="mt-1 text-xs break-all opacity-65">
				{editor.state?.file ?? "読み込み中…"}
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<button
				role="switch"
				aria-checked={mode === "toml"}
				aria-label="TOML 編集"
				disabled={mode === "toml" && !valid}
				onclick={switchMode}
				>{mode === "graph" ? "グラフ → TOML" : "TOML → グラフ"}</button
			><WorkflowActions
				{...{
					editor,
					bridge,
					disabled,
					dirty,
					valid,
				}}
			/>
		</div>
	</div>
	<p class="mt-3 text-xs opacity-65">
		グラフで編集すると TOML
		の書式は整えられ、コメントは削除されます。配置は表示専用です。
	</p>
</header>

<script lang="ts">
	// 編集対象の値と操作を、親の文書状態から受け取る。

	import { cn } from "cnfast";

	import { type WorkflowBridge } from "@nerita/shared/workflows/messages";

	import { type WorkflowEditorState } from "./WorkflowToolbarParts";

	let {
		editor,
		bridge,
		disabled,
		dirty,
		valid,
	}: {
		editor: WorkflowEditorState;
		bridge: WorkflowBridge;
		disabled: boolean;
		dirty: boolean;
		valid: boolean;
	} = $props();
</script>

<button
	aria-label="保存"
	class={cn(dirty && "workflow-unsaved")}
	{disabled}
	onclick={() => editor.request("save")}>保存{dirty ? " ●" : ""}</button
><button {disabled} onclick={() => editor.request("check")}
	>検証
</button><button
	class="workflow-primary"
	disabled={disabled || dirty || !valid}
	onclick={() => editor.request("run")}
	>実行
</button><button
	disabled={!(editor.state?.running === true)}
	onclick={() => bridge.postMessage({ type: "stop" })}
	>停止
</button><button onclick={() => bridge.postMessage({ type: "chat" })}
	>AgentViewer
</button>

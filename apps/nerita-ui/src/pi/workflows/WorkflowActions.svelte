<script lang="ts">
	// 文書の保存・検証・実行・停止を要求し、編集状態に応じて操作を無効にする。

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

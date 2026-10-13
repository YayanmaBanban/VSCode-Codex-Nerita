<script lang="ts">
	// 判定シミュレーションに使うツールと作業ディレクトリを入力する。

	import { guardProbeSchema } from "@nerita/shared/guardrails/messages";

	import { cn } from "cnfast";

	import "../../chat/chat.css";

	import "./guardrails.css";

	import { inputStyle } from "./fields";

	import { type GuardrailsProbeTargetProps } from "./GuardrailsEditorParts";

	let { probe, setProbe }: GuardrailsProbeTargetProps = $props();
</script>

<div class={cn("grid grid-cols-1 gap-3", "sm:grid-cols-2")}>
	<label
		>Tool
		<select
			class={inputStyle}
			value={probe.tool}
			onchange={(event) =>
				setProbe({
					...probe,
					tool: guardProbeSchema.shape.tool.parse(
						event.currentTarget.value,
					),
				})}
			>{#each ["read", "ls", "write", "edit", "powershell", "pwsh", "bash", "extension"] as tool (tool)}
				<option>{tool}</option>
			{/each}</select
		></label
	><label
		>cwd（ワークスペース基準）
		<input
			class={inputStyle}
			value={probe.cwd}
			maxlength={4096}
			oninput={(event) =>
				setProbe({
					...probe,
					cwd: event.currentTarget.value,
				})}
		/></label
	>
</div>

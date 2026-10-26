<!-- 判定シミュレーションに使うツールと作業ディレクトリを入力する。 -->
<script lang="ts">
	import { guardProbeSchema } from "@nerita/shared/guardrails/messages";

	import { cn } from "cnfast";

	import "../../chat/chat.css";

	import "./guardrails.css";

	import { inputStyle } from "./fields";

	import { type GuardrailsProbeTargetProps } from "./GuardrailsEditorParts";
	import GuardrailsSelect from "./GuardrailsSelect.svelte";

	let { probe, setProbe }: GuardrailsProbeTargetProps = $props();
</script>

<div class={cn("grid grid-cols-1 gap-3")}>
	<GuardrailsSelect
		label="Tool"
		value={probe.tool}
		options={[
			"read",
			"ls",
			"write",
			"edit",
			"powershell",
			"pwsh",
			"bash",
			"extension",
		].map((value) => ({ value, name: value }))}
		onChange={(value) =>
			setProbe({
				...probe,
				tool: guardProbeSchema.shape.tool.parse(value),
			})}
	/>
	<label
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

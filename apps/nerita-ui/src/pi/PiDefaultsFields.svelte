<script lang="ts">
	// 編集対象の値と操作を、親の文書状態から受け取る。

	import { isNonEmptyString } from "@nerita/shared/valuePredicates";

	import {
		piDefaultsSchema,
		piThinkingSchema,
	} from "@nerita/shared/agentManager/config";

	import { effortOptions } from "@nerita/shared/agentManager/effort";

	import { cn } from "cnfast";

	import EffortField from "../agentManager/EffortField.svelte";

	import Field from "../agentManager/Field.svelte";

	import ModelField from "../agentManager/ModelField.svelte";

	import { buttonStyle, inputStyle } from "../agentManager/managerFields";

	import { type PiDefaultsFieldsProps } from "./PiDefaultsSettingsParts";

	let { busy, edit, models, setEdit, error }: PiDefaultsFieldsProps =
		$props();
</script>

<fieldset disabled={busy} class="m-0 grid min-w-0 gap-4 border-0 p-0">
	<ModelField
		value={edit.defaultModel}
		{models}
		onChange={(defaultModel: string | undefined) =>
			setEdit({ ...edit, defaultModel })}
	/>{#each ["defaultThinking", "maxThinking"] as const as key (key)}
		{#key key}
			<EffortField
				label={key === "defaultThinking"
					? "Default thinking"
					: "Max thinking"}
				value={edit[key]}
				options={key === "maxThinking"
					? piThinkingSchema.options
					: effortOptions(models, edit.defaultModel)}
				onChange={(value: string | undefined) =>
					setEdit(
						piDefaultsSchema.parse({
							...edit,
							[key]: value,
						}),
					)}
			/>
		{/key}
	{/each}
	<p class="m-0 text-xs text-muted">
		Max thinking
		はモデル共通の上限です。選択モデルに対応する推論候補とは異なります。
	</p>
	<Field label="セッション内の起動上限"
		><input
			class={inputStyle}
			type="number"
			min={0}
			max={100000}
			step={1}
			value={edit.maxSubagentSpawnsPerSession ?? ""}
			placeholder="未指定"
			oninput={(event) =>
				setEdit({
					...edit,
					maxSubagentSpawnsPerSession:
						event.currentTarget.value === ""
							? undefined
							: Number(event.currentTarget.value),
				})}
		/></Field
	><button
		disabled={isNonEmptyString(error)}
		class={cn(buttonStyle, "justify-self-start")}
		type="submit"
		>既定値を保存
	</button>{#if isNonEmptyString(error)}
		<p role="alert" class="text-sm">{error}</p>
	{/if}
</fieldset>

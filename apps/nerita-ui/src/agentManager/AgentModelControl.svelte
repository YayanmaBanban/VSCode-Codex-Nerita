<!-- 管理画面のモデルと推論候補を、共通の設定カードへ渡す。 -->
<script lang="ts">
	import { nonEmptyString } from "@nerita/shared/valuePredicates";
	import type { ManagerModel } from "@nerita/shared/agentManager/messages";
	import { modelControl, reasoningLabel } from "@nerita/shared/settingsCards";
	import SliderCard from "../contributions/SliderCard.svelte";
	import { managerOption } from "./modelOptions";
	import FieldErrorTooltip from "../ui/FieldErrorTooltip.svelte";

	let {
		models,
		model,
		effort,
		disabled,
		onChange,
		allowUnspecified = true,
		error,
	}: {
		models: ManagerModel[];
		model?: string | undefined;
		effort?: string | undefined;
		disabled: boolean;
		allowUnspecified?: boolean;
		error?: string | undefined;
		onChange: (
			key: "model" | "reasoning_effort",
			value: string | undefined,
		) => void;
	} = $props();
	let option = $derived(
		managerOption("model", "モデル", model, models, allowUnspecified),
	);
	let reasoning = $derived(
		managerOption(
			"reasoning_effort",
			"推論",
			effort,
			(models.find((item) => item.value === model)?.efforts ?? []).map(
				(value) => ({ value, name: reasoningLabel(value) }),
			),
			allowUnspecified,
		),
	);
</script>

<FieldErrorTooltip message={error}>
	{#snippet children({ props })}
		<div role="group" aria-label="モデルと推論の設定" {...props}>
			<SliderCard
				control={modelControl(option, [reasoning])}
				{disabled}
				onChange={(key: string, value: string) =>
					onChange(
						key === "model" ? "model" : "reasoning_effort",
						nonEmptyString(value) ?? undefined,
					)}
			/>
		</div>
	{/snippet}
</FieldErrorTooltip>

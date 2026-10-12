<!-- バックエンドごとの引継ぎモデルの方式と、推論の設定を編集する。 -->
<script lang="ts">
	import type { BackendId } from "@nerita/shared/backend";
	import type { HandoffConfig } from "@nerita/shared/agentManager/config";
	import { effortOptions } from "@nerita/shared/agentManager/effort";
	import type { ManagerState } from "@nerita/shared/agentManager/messages";
	import Field from "./Field.svelte";
	import EffortField from "./EffortField.svelte";
	import HandoffModelField from "./HandoffModelField.svelte";
	import { inputStyle } from "./managerFields";
	let {
		backend,
		config,
		state,
		onChange,
	}: {
		backend: BackendId;
		config: HandoffConfig;
		state: ManagerState;
		onChange: (config: HandoffConfig) => void;
	} = $props();
	let item = $derived(config.backends[backend]);
	let currentOptions = $derived(
		effortOptions(state.models[backend], state.currentModels?.[backend]),
	);
	function strategy(value: string) {
		const { model: _model, ...rest } = {
			...item,
			model: "model" in item ? item.model : undefined,
		};
		onChange({
			...config,
			backends: {
				...config.backends,
				[backend]:
					value === "current"
						? { ...rest, strategy: "current" }
						: { ...rest, strategy: "fixed", model: "" },
			},
		});
	}
	function setModel(model: string) {
		onChange({
			...config,
			backends: { ...config.backends, [backend]: { ...item, model } },
		});
	}
	function setEffort(value: string | undefined) {
		onChange({
			...config,
			backends: {
				...config.backends,
				[backend]: {
					...item,
					[backend === "pi" ? "thinking" : "reasoningEffort"]: value,
				},
			},
		});
	}
</script>

<section
	class="grid min-w-0 content-start gap-4 rounded-lg border border-input-border p-4"
	aria-label={`${backend} ハンドオフ`}
>
	<h3 class="m-0 font-semibold">{backend === "pi" ? "Pi" : "Codex"}</h3>
	<Field label={`${backend} Strategy`}
		><select
			class={inputStyle}
			value={item.strategy}
			onchange={(event) => strategy(event.currentTarget.value)}
			><option value="current">current — 現在のセッション</option><option
				value="fixed">fixed — 固定モデル</option
			></select
		></Field
	>
	{#if item.strategy === "fixed"}<HandoffModelField
			label={`${backend} Model`}
			value={item.model}
			models={state.models[backend]}
			onChange={setModel}
		/>{/if}
	<EffortField
		label={backend === "pi" ? "Thinking" : "Reasoning effort"}
		value={backend === "pi"
			? config.backends.pi.thinking
			: config.backends.codex.reasoningEffort}
		options={item.strategy === "fixed"
			? effortOptions(state.models[backend], item.model)
			: currentOptions}
		onChange={setEffort}
	/>
	{#if item.strategy === "current"}<p class="m-0 text-xs text-muted">
			未指定なら現在のモデルに従います。推論を指定した場合は、実行時の対応確認が必要です。
		</p>{/if}
</section>

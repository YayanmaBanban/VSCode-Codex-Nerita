<!-- バックエンドごとの引継ぎモデルの方式と、推論の設定を編集する。 -->
<script lang="ts">
	import type { BackendId } from "@nerita/shared/backend";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import type { HandoffConfig } from "@nerita/shared/agentManager/config";
	import { effortOptions } from "@nerita/shared/agentManager/effort";
	import { defaultHandoffModel } from "@nerita/shared/agentManager/handoffModels";
	import type { ManagerState } from "@nerita/shared/agentManager/messages";
	import Field from "./Field.svelte";
	import EffortField from "./EffortField.svelte";
	import HandoffModelField from "./HandoffModelField.svelte";
	import ConfigControl from "../chat/composer/ConfigControl.svelte";

	let {
		backend,
		config,
		state,
		onChange,
		effortError,
	}: {
		backend: BackendId;
		config: HandoffConfig;
		state: ManagerState;
		onChange: (config: HandoffConfig) => void;
		effortError?: string | undefined;
	} = $props();
	let item = $derived(config.backends[backend]);
	let currentOptions = $derived(
		state.currentEfforts?.[backend] ??
			effortOptions(
				state.models[backend],
				state.currentModels?.[backend],
			),
	);
	/** 現在のセッションのモデルを使う方式へ切り替えた場合は、固定モデルの指定を残さない。 */
	function strategy(value: string) {
		const model = defaultHandoffModel(backend, state.models[backend]);
		if (value === "fixed" && model === undefined) {
			return;
		}
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
						: { ...rest, strategy: "fixed", model },
			},
		});
	}
	/** 対象バックエンドの固定モデルだけを更新し、他の引き継ぎ設定は保持する。 */
	function setModel(model: string) {
		onChange({
			...config,
			backends: { ...config.backends, [backend]: { ...item, model } },
		});
	}
	/** 対象バックエンドの推論設定を、バックエンドに対応する保存キーで更新する。 */
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
	<Field label="モデル選択のモード">
		<ConfigControl
			appearance="field"
			option={{
				id: `${backend}-handoff-strategy`,
				name: "モデル選択のモード",
				currentValue: item.strategy,
				options: [
					{
						value: "current",
						name: "現在のセッションのモデルを使用",
					},
					{ value: "fixed", name: "モデルを固定する" },
				],
			}}
			disabled={false}
			disabledValues={state.models[backend].length === 0 ? ["fixed"] : []}
			onChange={strategy}
		/>
	</Field>
	{#if item.strategy === "fixed"}
		<HandoffModelField
			label="モデル"
			value={item.model}
			models={state.models[backend]}
			onChange={setModel}
		/>
	{/if}
	<EffortField
		label="推論レベル"
		value={backend === "pi"
			? config.backends.pi.thinking
			: config.backends.codex.reasoningEffort}
		options={item.strategy === "fixed"
			? effortOptions(state.models[backend], item.model)
			: currentOptions}
		emptyMessage={item.strategy === "current"
			? "現在のセッションの推論レベルを取得できません。セッションに接続して再読み込みしてください。"
			: undefined}
		onChange={setEffort}
	/>
	{#if isNonEmptyString(effortError)}
		<p role="alert" class="m-0 text-sm leading-relaxed text-warning">
			{effortError}
		</p>
	{/if}
	<p class="m-0 text-xs text-muted">
		推論レベルが未指定の場合は、バックエンドの既定値に任せます
	</p>
</section>

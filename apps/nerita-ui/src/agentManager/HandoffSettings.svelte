<!-- 引継ぎに使うモデルを保存し、モデル実行やセッション移行は開始しない。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import {
		isNonEmptyString,
		nonZeroNumber,
	} from "@nerita/shared/valuePredicates";
	import {
		handoffSchema,
		type HandoffConfig,
	} from "@nerita/shared/agentManager/config";
	import { handoffEffortError } from "@nerita/shared/agentManager/effort";
	import type { ManagerState } from "@nerita/shared/agentManager/messages";
	import type { ManagerSave } from "./useAgentManager.svelte";
	import Field from "./Field.svelte";
	import HandoffBackendSettings from "./HandoffBackendSettings.svelte";
	import { buttonStyle, inputStyle } from "./managerFields";
	let {
		state: hostState,
		busy,
		save,
		onDirty,
	}: {
		state: ManagerState;
		busy: boolean;
		save: ManagerSave;
		onDirty?: () => void;
	} = $props();
	let config = $state.raw<HandoffConfig>(untrack(() => hostState.handoff));
	let repair = $state(false);
	let error = $state<string>();
	let locked = $derived(
		busy || (isNonEmptyString(hostState.handoffError) && !repair),
	);
	let effortError = $derived(
		handoffEffortError(
			config,
			hostState.handoff,
			hostState.models,
			hostState.activeBackend,
		),
	);
	function change(next: HandoffConfig) {
		config = next;
		onDirty?.();
	}
	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (locked || isNonEmptyString(effortError)) {
			return;
		}
		const parsed = handoffSchema.safeParse(config);
		if (!parsed.success) {
			error = "固定モデルと正の整数の timeout を指定してください。";
			return;
		}
		error = undefined;
		save({
			type: "handoff",
			backend: hostState.activeBackend,
			config: parsed.data,
		});
	}
</script>

<form class="grid gap-5" onsubmit={submit}>
	<div>
		<h2 class="m-0 text-lg font-semibold">ハンドオフ設定</h2>
		<p class="text-sm text-muted">
			引継ぎに使うモデルを保存します。実行開始時のモデルを使う場合は
			current を選びます。
		</p>
	</div>
	{#if isNonEmptyString(hostState.handoffError)}<div
			role="alert"
			class="grid gap-3 rounded-md border border-input-border p-3 text-sm break-words"
		>
			<span>{hostState.handoffError}</span><button
				class={buttonStyle}
				type="button"
				disabled={busy || repair}
				onclick={() => {
					repair = true;
					onDirty?.();
				}}>初期値から設定を作り直す</button
			>
		</div>{/if}
	{#if isNonEmptyString(error)}<p role="alert" class="text-sm">
			{error}
		</p>{/if}
	<fieldset disabled={locked} class="m-0 grid min-w-0 gap-5 border-0 p-0">
		<Field label="Timeout (ms)"
			><input
				class={inputStyle}
				type="number"
				required
				min={1}
				max={2147483647}
				step={1}
				value={nonZeroNumber(config.defaults.timeoutMs) ?? ""}
				oninput={(event) =>
					change({
						...config,
						defaults: {
							timeoutMs: Number(event.currentTarget.value),
						},
					})}
			/></Field
		>
		<div class="grid gap-5">
			<HandoffBackendSettings
				backend={hostState.activeBackend}
				{config}
				state={hostState}
				onChange={change}
			/>
		</div>
		<button
			disabled={isNonEmptyString(effortError)}
			class={`${buttonStyle} justify-self-start`}
			type="submit">ハンドオフ設定を保存</button
		>{#if isNonEmptyString(effortError)}<p role="alert" class="text-sm">
				{effortError}
			</p>{/if}
	</fieldset>
	<p class="m-0 text-xs text-muted">保存先: .nerita/handoff.json</p>
</form>

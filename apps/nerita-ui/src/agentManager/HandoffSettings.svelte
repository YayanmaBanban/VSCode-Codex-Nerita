<!-- 引継ぎに使うモデルを保存し、モデル実行やセッション移行は開始しない。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import { cn } from "cnfast";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import {
		handoffSchema,
		type HandoffConfig,
	} from "@nerita/shared/agentManager/config";
	import { handoffEffortError } from "@nerita/shared/agentManager/effort";
	import type { ManagerState } from "@nerita/shared/agentManager/messages";
	import type { ManagerSave } from "./useAgentManager.svelte";
	import HandoffBackendSettings from "./HandoffBackendSettings.svelte";
	import { buttonStyle } from "./managerFields";
	import NumericField from "../ui/NumericField.svelte";
	import HelpHeader from "../ui/HelpHeader.svelte";
	import SaveFooter from "./SaveFooter.svelte";

	let {
		state: hostState,
		busy,
		dirty,
		saved,
		save,
		onDirty,
		onDiscard,
	}: {
		state: ManagerState;
		busy: boolean;
		dirty: boolean;
		saved: boolean;
		save: ManagerSave;
		onDirty?: () => void;
		onDiscard?: (() => void) | undefined;
	} = $props();
	let config = $state.raw<HandoffConfig>(untrack(() => hostState.handoff));
	let repair = $state(false);
	let error = $state<string>();
	let timeoutSeconds = $derived(
		Number.isFinite(config.defaults.timeoutMs)
			? config.defaults.timeoutMs / 1000
			: undefined,
	);
	let timeoutInvalid = $derived(
		!handoffSchema.shape.defaults.safeParse(config.defaults).success,
	);
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
	/** 引き継ぎ設定の下書きを保持し、未保存の変更を親へ通知する。 */
	function change(next: HandoffConfig) {
		config = next;
		onDirty?.();
	}
	/** 引き継ぎ設定と推論候補を検証して保存を要求し、変更できない状態では送信しない。 */
	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (locked || timeoutInvalid || isNonEmptyString(effortError)) {
			return;
		}
		const parsed = handoffSchema.safeParse(config);
		if (!parsed.success) {
			error = "モデルとタイムアウトの設定を確認してください。";
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

<form class="grid gap-5 pb-24" onsubmit={submit}>
	<HelpHeader title="ハンドオフ設定" helpLabel="ハンドオフ設定のヘルプ">
		<p class="m-0">
			セッションの内容を要約し、引き継ぎ文を生成するモデルを設定します。
		</p>
		<p class="m-0 mt-1">保存先: <code>.nerita/handoff.json</code></p>
	</HelpHeader>
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
		<div class="grid gap-5">
			<HandoffBackendSettings
				backend={hostState.activeBackend}
				{config}
				state={hostState}
				{effortError}
				onChange={change}
			/>
		</div>
		<details
			open
			class="group min-w-0 rounded-lg border border-input-border p-4"
		>
			<summary
				class={cn(
					"flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold",
					"focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden",
				)}
			>
				実行設定
				<ChevronDown
					size={16}
					aria-hidden="true"
					class="shrink-0 group-open:rotate-180"
				/>
			</summary>
			<div class="grid gap-2 pt-3">
				<NumericField
					label="タイムアウト"
					unit="秒"
					min={1}
					max={600}
					step={1}
					value={timeoutSeconds}
					disabled={locked}
					description="ハンドオフの完了を待つ最大時間です。"
					onChange={(seconds) =>
						change({
							...config,
							defaults: {
								timeoutMs:
									seconds === undefined
										? Number.NaN
										: seconds * 1000,
							},
						})}
				/>
			</div>
		</details>
	</fieldset>
	<SaveFooter
		{onDiscard}
		discardDisabled={busy}
		{dirty}
		{saved}
		disabled={locked || timeoutInvalid || isNonEmptyString(effortError)}
		label="変更を保存"
	/>
</form>

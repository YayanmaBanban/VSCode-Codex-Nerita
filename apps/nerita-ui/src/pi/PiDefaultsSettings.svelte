<!-- Pi の既定設定を下書きとして編集し、モデルの推論設定を検証して保存を要求する。 -->
<script lang="ts">
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import {
		piDefaultsSchema,
		type PiDefaults,
	} from "@nerita/shared/agentManager/config";
	import { effortError } from "@nerita/shared/agentManager/effort";
	import { agentModelError } from "@nerita/shared/agentManager/validation";

	import { untrack } from "svelte";

	let {
		defaults,
		models,
		busy,
		save,
		dirty = false,
		saved = false,
		onDiscard,
	}: PiDefaultsSettingsProps = $props();
	let edit = $state.raw(untrack(() => defaults));

	let error = $derived(
		effortError(
			models,
			edit.defaultModel,
			edit.defaultThinking,
			defaults.defaultModel,
			defaults.defaultThinking,
		) ?? agentModelError(models, edit.defaultModel, defaults.defaultModel),
	);
	let invalid = $derived(
		!piDefaultsSchema.safeParse(edit).success || isNonEmptyString(error),
	);

	import { type PiDefaultsSettingsProps } from "./PiDefaultsSettingsParts";
	import PiDefaultsFields from "./PiDefaultsFields.svelte";
	import AgentManagerFooter from "../agentManager/AgentManagerFooter.svelte";
	/** 入力欄から受け取った Pi の既定設定を、保存前の下書きとして保持する。 */
	const setEdit = (value: PiDefaults) => {
		edit = value;
	};
</script>

<form
	class="grid gap-4 pb-24"
	onsubmit={(event) => {
		event.preventDefault();
		if (invalid) {
			return;
		}
		save({
			type: "defaults",
			defaults: piDefaultsSchema.parse(edit),
		});
	}}
>
	<h2 class="m-0 text-lg font-semibold">Workspace defaults</h2>
	<PiDefaultsFields {...{ busy, edit, models, setEdit, error }} />
	<p class="m-0 text-xs text-muted">
		保存先:
		.pi/settings.json。既定値は個別設定やエージェント定義で未指定の場合に使います。上限はすべての子エージェントに適用します。
	</p>
	<AgentManagerFooter
		{dirty}
		{saved}
		{onDiscard}
		discardDisabled={busy}
		disabled={busy || invalid}
		label="変更を保存"
	/>
</form>

<script lang="ts">
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import {
		piDefaultsSchema,
		type PiDefaults,
	} from "@nerita/shared/agentManager/config";
	import { effortError } from "@nerita/shared/agentManager/effort";

	import { untrack } from "svelte";
	let { defaults, models, busy, save }: PiDefaultsSettingsProps = $props();
	let edit = $state.raw(untrack(() => defaults));

	let error = $derived(
		effortError(
			models,
			edit.defaultModel,
			edit.defaultThinking,
			defaults.defaultModel,
			defaults.defaultThinking,
		),
	);

	import { type PiDefaultsSettingsProps } from "./PiDefaultsSettingsParts";
	import PiDefaultsFields from "./PiDefaultsFields.svelte";
	/** 入力欄から受け取った Pi の既定設定を、保存前の下書きとして保持する。 */
	const setEdit = (value: PiDefaults) => {
		edit = value;
	};
</script>

<form
	class="grid gap-4"
	onsubmit={(event) => {
		event.preventDefault();
		if (isNonEmptyString(error)) {
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
		保存先: .pi/settings.json。設定の優先順位は Pi 側に任せます。
	</p>
</form>

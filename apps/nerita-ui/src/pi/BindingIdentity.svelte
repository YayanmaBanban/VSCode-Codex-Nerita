<script lang="ts">
	// 資格情報の参照 ID と利用先を入力し、既存の参照 ID は変更できないようにする。

	import { type CredentialBinding } from "@nerita/shared/credentials";

	let {
		binding,
		busy,
	}: {
		binding: CredentialBinding | undefined;
		busy: boolean;
	} = $props();
</script>

<label
	>Binding ID <input
		name="id"
		required
		value={binding?.id}
		disabled={busy || Boolean(binding)}
		class="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
	/></label
>{#if binding}
	<input type="hidden" name="id" value={binding.id} />
{/if}<label
	>対象 <input
		name="target"
		required
		value={binding?.match.target}
		placeholder="npm.pkg.github.com"
		disabled={busy}
		class="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
	/></label
>

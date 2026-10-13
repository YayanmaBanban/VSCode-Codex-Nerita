<script lang="ts">
	// Bitwarden の秘密情報を参照する ID とアカウントを入力し、秘密値は扱わない。

	import { type CredentialBinding } from "@nerita/shared/credentials";

	let {
		binding,
		busy,
	}: {
		binding: CredentialBinding | undefined;
		busy: boolean;
	} = $props();
	let reference = $derived(
		binding?.provider.type === "bitwarden-secrets-manager"
			? binding.provider
			: undefined,
	);
</script>

<label
	>シークレット ID <input
		name="secretId"
		required
		value={reference?.secretId}
		disabled={busy}
		class="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
	/></label
><label
	>プロジェクト ID（任意） <input
		name="projectId"
		value={reference?.projectId}
		disabled={busy}
		class="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
	/></label
><label
	>マシンアカウント ID <input
		name="accountId"
		required
		value={reference?.accountId ?? "default"}
		disabled={busy}
		class="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
	/></label
>

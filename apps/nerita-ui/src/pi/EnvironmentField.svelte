<script lang="ts">
	// 編集対象の値と操作を、親の文書状態から受け取る。

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
	>注入先の環境変数名 <input
		name="name"
		required
		value={binding?.injection.type === "env" ? binding.injection.name : ""}
		disabled={busy}
		class="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
	/></label
>

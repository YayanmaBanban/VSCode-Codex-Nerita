<!-- 資格情報の注入先となる環境変数名を入力し、保存処理は親へ任せる。 -->
<script lang="ts">
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

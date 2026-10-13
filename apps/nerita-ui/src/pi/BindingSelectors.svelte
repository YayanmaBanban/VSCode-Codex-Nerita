<script lang="ts">
	// 資格情報の用途と取得元を選び、検証した選択値を親へ返す。

	import {
		credentialKindSchema,
		credentialBindingSchema,
		type CredentialBinding,
	} from "@nerita/shared/credentials";

	let {
		busy,
		provider,
		setProvider,
		kind,
		setKind,
	}: {
		busy: boolean;
		provider: CredentialBinding["provider"]["type"];
		setProvider: (value: CredentialBinding["provider"]["type"]) => void;
		kind: CredentialBinding["match"]["kind"];
		setKind: (value: CredentialBinding["match"]["kind"]) => void;
	} = $props();
</script>

<label
	>用途 <select
		value={kind}
		disabled={busy}
		onchange={(event) =>
			setKind(credentialKindSchema.parse(event.currentTarget.value))}
		class="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
		><option value="git-https">Git HTTPS</option><option
			value="npm-registry">npm レジストリ</option
		><option value="api-token">API トークン</option><option
			value="username-password"
			>ユーザー名・パスワード
		</option></select
	></label
><label
	>Provider <select
		value={provider}
		disabled={busy}
		onchange={(event) =>
			setProvider(
				credentialBindingSchema.shape.provider.options
					.map((option) => option.shape.type.value)
					.find((type) => type === event.currentTarget.value) ??
					provider,
			)}
		class="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
		><option value="git">Git</option><option value="npmrc">npmrc</option
		><option value="bitwarden-secrets-manager"
			>Bitwarden Secrets Manager
		</option></select
	></label
>

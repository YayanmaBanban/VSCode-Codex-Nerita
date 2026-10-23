<!-- 資格情報の取得元・用途・注入先を編集し、入力を検証して参照設定を親へ返す。 -->
<script lang="ts">
	import { untrack } from "svelte";
	import { type CredentialBinding } from "@nerita/shared/credentials";

	let {
		binding,
		busy,
		save,
	}: {
		binding: CredentialBinding | undefined;
		busy: boolean;
		save: (binding: CredentialBinding) => void;
	} = $props();
	let provider = $state<CredentialBinding["provider"]["type"]>(
		untrack(() => binding?.provider.type ?? "bitwarden-secrets-manager"),
	);
	let kind = $state<CredentialBinding["match"]["kind"]>(
		untrack(() => binding?.match.kind ?? "npm-registry"),
	);
	let error = $state("");

	import { parseBindingForm } from "./CredentialBindingFormParts";
	import BitwardenFields from "./BitwardenFields.svelte";
	import EnvironmentField from "./EnvironmentField.svelte";
	import BindingIdentity from "./BindingIdentity.svelte";
	import BindingSelectors from "./BindingSelectors.svelte";
	/** 選択した資格情報の取得元を保持し、対応する入力欄へ切り替える。 */
	const setProvider = (value: CredentialBinding["provider"]["type"]) => {
		provider = value;
	};

	/** 資格情報の用途を保持し、用途に合う注入先の入力欄へ切り替える。 */
	const setKind = (value: CredentialBinding["match"]["kind"]) => {
		kind = value;
	};

	/** 参照設定の入力検証結果をフォームに表示する。 */
	const setError = (value: string) => {
		error = value;
	};
</script>

<form
	class="mt-[16px] flex max-w-[560px] flex-col gap-[12px]"
	onsubmit={(event) => {
		event.preventDefault();
		const parsed = parseBindingForm(
			new FormData(event.currentTarget),
			provider,
			kind,
		);
		if (!parsed.success) {
			setError("ID・対象・Provider と注入方式を確認してください。");
			return;
		}
		setError("");
		save(parsed.data);
	}}
>
	<BindingIdentity {...{ binding, busy }} />
	<BindingSelectors
		{...{
			busy,
			provider,
			setProvider,
			kind,
			setKind,
		}}
	/>
	{#if provider === "bitwarden-secrets-manager"}
		<BitwardenFields {...{ binding, busy }} />
	{/if}
	{#if kind.endsWith("token") || kind === "username-password"}
		<EnvironmentField {...{ binding, busy }} />
	{/if}
	{#if error !== ""}
		<p role="alert">{error}</p>
	{/if}
	<button type="submit" disabled={busy}>Binding を保存 </button>
</form>

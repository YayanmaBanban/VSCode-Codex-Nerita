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
	/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
	const setProvider = (value: CredentialBinding["provider"]["type"]) => {
		provider = value;
	};

	/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
	const setKind = (value: CredentialBinding["match"]["kind"]) => {
		kind = value;
	};

	/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
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
	<BindingIdentity {...{ binding, busy }} /><BindingSelectors
		{...{
			busy,
			provider,
			setProvider,
			kind,
			setKind,
		}}
	/>{#if provider === "bitwarden-secrets-manager"}
		<BitwardenFields {...{ binding, busy }} />
	{/if}{#if kind.endsWith("token") || kind === "username-password"}
		<EnvironmentField {...{ binding, busy }} />
	{/if}{#if error !== ""}
		<p role="alert">{error}</p>
	{/if}<button type="submit" disabled={busy}>Binding を保存 </button>
</form>

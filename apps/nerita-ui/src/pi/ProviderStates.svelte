<script lang="ts">
	// 編集対象の値と操作を、親の文書状態から受け取る。

	import { isNonEmptyString } from "@nerita/shared/valuePredicates";

	import "../chat/chat.css";
	import {
		type State,
		providerStatus,
		providerName,
	} from "./CredentialProviderSettingsParts";

	let { providers }: { providers: State["providers"] } = $props();
</script>

{#each providers as provider (`${provider.id}:${provider.accountId ?? ""}`)}
	<p class="break-words">
		{`${providerName(provider.id)}${isNonEmptyString(provider.accountId) ? ` · ${provider.accountId}` : ""} · ${providerStatus(provider)}`}
	</p>
{/each}

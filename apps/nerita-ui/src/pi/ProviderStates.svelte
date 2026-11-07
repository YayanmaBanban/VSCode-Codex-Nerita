<!-- 資格情報の取得元ごとに利用可否・認証状態・エラーを表示する。 -->
<script lang="ts">
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import type { HostPresentation } from "@nerita/shared/hostPresentation";

	import "../chat/chat.css";
	import {
		type State,
		providerStatus,
		providerName,
	} from "./CredentialProviderSettingsParts";

	let {
		providers,
		storageLabels,
	}: {
		providers: State["providers"];
		storageLabels: HostPresentation["credentialStorageLabels"];
	} = $props();
</script>

{#each providers as provider (`${provider.id}:${provider.accountId ?? ""}`)}
	<p class="break-words">
		{`${providerName(provider.id)}${isNonEmptyString(provider.accountId) ? ` · ${provider.accountId}` : ""} · ${providerStatus(provider, storageLabels)}`}
	</p>
{/each}

<script lang="ts">
	// 資格情報の取得元ごとに利用可否・認証状態・エラーを表示する。

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

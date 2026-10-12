<script lang="ts">
	import {
		credentialStorageModeSchema,
		type CredentialRequest,
		type CredentialStorageMode,
	} from "@nerita/shared/credentials";

	import "../chat/chat.css";

	let {
		state: hostState,
		send,
	}: { state: State; send: (request: CredentialRequest) => void } = $props();
	let mode = $state<CredentialStorageMode>("secret-storage");
	let accountId = $state("default");

	import { type State } from "./CredentialProviderSettingsParts";
	import ProviderStates from "./ProviderStates.svelte";
	/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
	const setMode = (value: CredentialStorageMode) => {
		mode = value;
	};

	/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
	const setAccountId = (value: string) => {
		accountId = value;
	};
</script>

<section aria-label="Provider" class="mb-[24px]">
	<h2 class="text-[16px] font-semibold">Provider</h2>
	<ProviderStates {...{ providers: hostState.providers }} />
	<div class="mt-[12px] grid gap-[12px] sm:grid-cols-2">
		<label
			>マシンアカウント ID <input
				aria-label="マシンアカウント ID"
				class="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
				value={accountId}
				oninput={(event) => setAccountId(event.currentTarget.value)}
				disabled={hostState.busy}
			/></label
		><label class="mr-[8px]"
			>保存方法 <select
				class="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
				value={mode}
				disabled={hostState.busy}
				onchange={(event) =>
					setMode(
						credentialStorageModeSchema.parse(
							event.currentTarget.value,
						),
					)}
				><option value="session">このセッションのみ</option><option
					value="secret-storage">VS Code に保存</option
				></select
			></label
		>
	</div>
	<div class="mt-[12px] flex flex-wrap gap-[8px]">
		<button
			disabled={hostState.busy}
			onclick={() =>
				send({
					type: "bws-login",
					accountId,
					mode,
				})}
			>Bitwarden の認証を設定
		</button><button
			disabled={hostState.busy}
			onclick={() => send({ type: "bws-logout", accountId })}
			>Bitwarden の認証を削除
		</button><button
			disabled={hostState.busy}
			onclick={() => send({ type: "migrate-pi" })}
			>既存 Pi 認証を移行
		</button><button
			disabled={hostState.busy}
			onclick={() => send({ type: "migrate-mcp" })}
			>既存 MCP 認証を移行
		</button>
	</div>
</section>

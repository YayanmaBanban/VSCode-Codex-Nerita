<!-- 資格情報の参照設定を一覧・編集し、保存・削除と取得元の操作を Host へ要求する。 -->
<script lang="ts">
	import {
		type CredentialBinding,
		type CredentialReply,
		type CredentialRequest,
	} from "@nerita/shared/credentials";

	import "../chat/chat.css";
	import BindingForm from "./CredentialBindingForm.svelte";

	/** 資格情報の状態応答だけを保持し、操作のエラーや通知は別に表示する。 */
	type State = Extract<CredentialReply, { type: "state" }>;

	import CredentialProviderSettings from "./CredentialProviderSettings.svelte";

	let {
		state: hostState,
		send,
		notice = "",
		error = "",
	}: {
		state: State;
		send: (request: CredentialRequest) => void;
		notice?: string;
		error?: string;
	} = $props();
	let editing = $state.raw<CredentialBinding>();
	/** 編集対象の資格情報の参照設定を保持し、未選択時は新規作成の入力へ切り替える。 */
	const setEditing = (value: CredentialBinding | undefined) => {
		editing = value;
	};
</script>

<main class="mx-auto w-full max-w-[960px] p-[20px] text-[13px]">
	<h1 class="mb-[8px] text-[22px] font-semibold">資格情報を管理</h1>
	<p class="mb-[20px] text-muted">
		Binding には秘密情報の参照と利用先を保存します。
	</p>
	{#if error !== ""}
		<p
			role="alert"
			class="rounded-[6px] border border-alert-border bg-alert p-[12px]"
		>
			{error}
		</p>
	{/if}
	{#if notice !== ""}
		<p role="status">{notice}</p>
	{/if}
	<CredentialProviderSettings state={hostState} {send} />
	<section aria-label="Binding">
		<h2 class="text-[16px] font-semibold">Binding</h2>
		{#each hostState.bindings as binding (binding.id)}
			<div
				class="my-[12px] flex flex-wrap items-center gap-[8px] border-b border-message-border pb-[12px]"
			>
				<span class="min-w-0 flex-1 break-words">
					{`${binding.id} · ${binding.match.target} · ${binding.provider.type}`}
				</span>
				<button
					disabled={hostState.busy}
					onclick={() => setEditing(binding)}
				>
					編集
				</button>
				<button
					disabled={hostState.busy}
					onclick={() =>
						send({ type: "delete-binding", id: binding.id })}
				>
					削除
				</button>
			</div>
		{/each}
		<button disabled={hostState.busy} onclick={() => setEditing(undefined)}>
			新しい Binding
		</button>
		{#key editing?.id ?? "new"}
			<BindingForm
				binding={editing}
				busy={hostState.busy}
				save={(binding: CredentialBinding) =>
					send({ type: "save-binding", binding })}
			/>
		{/key}
	</section>
</main>

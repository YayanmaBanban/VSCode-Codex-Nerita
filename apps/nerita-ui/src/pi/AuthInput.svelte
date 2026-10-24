<!-- 認証の入力要求に回答し、送信・中断・破棄時に入力欄の値を消去する。 -->
<script lang="ts">
	import {
		type PiAuthPrompt,
		type PiAuthRequest,
	} from "@nerita/shared/piAuth";
	import { cn } from "cnfast";
	import Tooltip from "../ui/Tooltip.svelte";

	import "../chat/chat.css";

	/** Host の入力要求と回答の送信先。回答は受け取った要求 ID に結び付ける。 */
	type AuthInputProps = {
		prompt: PiAuthPrompt;
		send: (request: PiAuthRequest) => void;
	};

	/** 送信・中断・破棄後に認証の入力値を DOM から消去する。 */
	function clearAuthInput(
		field: HTMLInputElement | HTMLSelectElement | null | undefined,
	) {
		if (field) {
			field.value = "";
		}
	}
	let { prompt, send }: AuthInputProps = $props();
	let inputRef: HTMLInputElement | undefined;
	let selectRef: HTMLSelectElement | undefined;
	let hasValue = $state(false);
	let inputType = $derived(prompt.secret ? "password" : "text");
	/** 認証の回答を送信できるか判定するため、入力値の有無だけを保持する。 */
	const setHasValue = (value: boolean) => {
		hasValue = value;
	};
	/** 認証入力へフォーカスを移し、要素の破棄時に入力値と参照を消去する。 */
	function focusInput(field: HTMLInputElement) {
		inputRef = field;
		field.focus();
		return () => {
			clearAuthInput(field);
			inputRef = undefined;
		};
	}
	/** 認証の選択欄へフォーカスを移し、要素の破棄時に選択値と参照を消去する。 */
	function focusSelect(field: HTMLSelectElement) {
		selectRef = field;
		field.focus();
		return () => {
			clearAuthInput(field);
			selectRef = undefined;
		};
	}
</script>

<form
	class="flex max-w-[560px] flex-col gap-[10px]"
	onsubmit={(event) => {
		event.preventDefault();
		const field = inputRef ?? selectRef;
		const value = field?.value ?? "";
		clearAuthInput(field);
		setHasValue(false);
		if (value !== "") {
			send({ type: "answer", id: prompt.id, value });
		}
	}}
>
	{#if prompt.options}
		<select
			id="auth-input"
			{@attach focusSelect}
			onchange={(event) =>
				setHasValue(Boolean(event.currentTarget.value))}
			class={cn(
				"rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text",
			)}
			><option value="">選択してください</option
			>{#each prompt.options as option (option.id)}
				<option value={option.id}>{option.label}</option>
			{/each}</select
		>
	{:else}
		<Tooltip content={prompt.message}>
			{#snippet children({ props: tooltipProps })}
				<input
					{...tooltipProps}
					id="auth-input"
					type={inputType}
					autocomplete="off"
					spellcheck={false}
					{@attach focusInput}
					placeholder={prompt.message}
					oninput={(event) =>
						setHasValue(Boolean(event.currentTarget.value))}
					class={cn(
						"min-w-0 rounded-[4px] border border-menu-border bg-menu p-[10px]",
						"text-menu-text outline-settings-focus",
					)}
				/>
			{/snippet}
		</Tooltip>
	{/if}
	<div class="mb-[16px] flex flex-wrap items-baseline gap-[8px]">
		<button type="submit" disabled={!hasValue}>送信 </button>
		<button
			type="button"
			onclick={() => {
				const field = inputRef ?? selectRef;
				clearAuthInput(field);
				setHasValue(false);
				send({ type: "cancel" });
			}}
			class="border-alert-border bg-alert"
			>キャンセル
		</button>
	</div>
</form>

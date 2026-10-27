<!-- 選択式・自由記述・機密情報の入力欄を質問カードに表示する。 -->
<script lang="ts">
	import type { QuestionField } from "@nerita/shared/questions";
	import { cn } from "cnfast";

	let {
		field,
		group,
		value = $bindable(""),
	}: { field: QuestionField; group: string; value?: string } = $props();
	let other = $state(false);
	let closingValue = $state("");
	const inputClass =
		"w-full min-w-0 rounded border border-solid border-input-border bg-input px-3 py-2 text-[13px] text-input-text focus:border-focus focus:outline-none";
	/** 自由入力の選択を解除して、指定されたラベルを回答にする。 */
	function select(label: string) {
		if (other) {
			closingValue = value;
		}
		other = false;
		value = label;
	}
	/** 以前の選択肢を自由入力の回答として送らないよう、値を空に戻す。 */
	function selectOther() {
		other = true;
		closingValue = "";
		value = "";
	}
</script>

<fieldset class="m-0 min-w-0 border-0 p-0">
	<legend class="mb-2 text-[13px] font-medium [overflow-wrap:anywhere]">
		{field.title}{#if !field.required}<span
				class="ml-2 font-normal text-muted"
			>
				省略可
			</span>{/if}
	</legend>
	{#if field.description !== undefined}
		<p
			class="mt-0 mb-3 text-[12px] [overflow-wrap:anywhere] whitespace-pre-wrap text-muted"
		>
			{field.description}
		</p>
	{/if}
	{#if field.options && field.secret !== true}
		<div class="flex flex-col gap-2">
			{#if !field.required}
				<label
					class="flex cursor-pointer items-center gap-2 text-[13px] text-muted"
					><input
						type="radio"
						name={group}
						checked={!other && value === ""}
						onchange={() => select("")}
						class="question-radio"
					/>省略</label
				>
			{/if}
			{#each field.options as option (option.label)}
				<label
					class={cn(
						"flex cursor-pointer items-start gap-2 rounded border border-solid border-panel-border",
						"px-3 py-2 hover:bg-settings-hover",
					)}
				>
					<input
						type="radio"
						name={group}
						checked={!other && value === option.label}
						onchange={() => select(option.label)}
						class="question-radio mt-1"
					/>
					<span class="min-w-0 text-[13px] [overflow-wrap:anywhere]"
						>{option.label}
						{#if option.description !== undefined}<span
								class="mt-1 block text-[12px] whitespace-pre-wrap text-muted"
							>
								{option.description}
							</span>{/if}
					</span>
				</label>
			{/each}
			{#if field.allowOther === true}
				<div
					class="question-other-option min-w-0 rounded border border-solid border-panel-border"
				>
					<label
						class="flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] hover:bg-settings-hover"
					>
						<input
							type="radio"
							name={group}
							checked={other}
							onchange={selectOther}
							class="question-radio"
						/>その他（自由入力）
					</label>
					<div
						class="question-other grid"
						data-open={other}
						inert={!other}
						aria-hidden={!other}
					>
						<div class="min-h-0 overflow-hidden">
							<div class="px-3 pt-1 pb-3">
								<input
									aria-label={`${field.title}の自由入力`}
									bind:value={
										() => (other ? value : closingValue),
										(inputValue: string) => {
											value = inputValue;
										}
									}
									class={inputClass}
								/>
							</div>
						</div>
					</div>
				</div>
			{/if}
		</div>
	{:else}
		{#if field.multiline === true && field.secret !== true}
			<textarea
				aria-label={field.title}
				bind:value
				placeholder={field.placeholder}
				class={`${inputClass} min-h-24 resize-y`}
				rows="4"></textarea>
		{:else}
			<input
				type={field.secret === true ? "password" : "text"}
				aria-label={field.title}
				bind:value
				placeholder={field.placeholder}
				autocomplete="off"
				class={inputClass}
			/>
		{/if}
	{/if}
</fieldset>

<style>
	/* ネイティブのラジオ操作を保ち、チェックの表示だけを中断可能な CSS 遷移にする。 */
	.question-radio {
		appearance: none;
		display: grid;
		place-content: center;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		margin-left: 0;
		margin-right: 0;
		padding: 0;
		border: 1px solid var(--nerita-description-foreground);
		border-radius: 50%;
		background: transparent;
	}
	.question-radio::before {
		content: "";
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--nerita-button-background);
		opacity: 0;
		transition: opacity 160ms ease-out;
	}
	.question-radio:checked::before {
		opacity: 1;
	}
	.question-radio:focus-visible {
		outline: 2px solid var(--nerita-focus-border);
		outline-offset: 2px;
	}
	/* 入力欄を枠内に保持し、閉じる途中でも隣の選択肢へすぐ切り替えられるようにする。 */
	.question-other {
		grid-template-rows: 0fr;
		opacity: 0;
		transition:
			grid-template-rows 220ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 160ms ease-out;
	}
	.question-other[data-open="true"] {
		grid-template-rows: 1fr;
		opacity: 1;
	}
	@media (prefers-reduced-motion: reduce) {
		.question-radio::before,
		.question-other {
			transition: none;
		}
	}
</style>

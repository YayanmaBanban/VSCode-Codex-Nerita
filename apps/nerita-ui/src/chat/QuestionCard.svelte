<!-- 通常のチャット送信とは別のメッセージで、表示中の質問に回答する。 -->
<script lang="ts">
	import MessageCircleQuestion from "@lucide/svelte/icons/message-circle-question-mark";
	import {
		questionFieldError,
		type QuestionRequest,
		type QuestionAnswer,
	} from "@nerita/shared/questions";
	import type { UiMessage } from "@nerita/shared/messages";
	import QuestionField from "./QuestionField.svelte";
	import ButtonCurtain from "../ui/ButtonCurtain.svelte";

	let {
		question,
		send,
	}: { question: QuestionRequest; send: (message: UiMessage) => void } =
		$props();
	// カードは質問 ID ごとにマウントされ、検証エラーで再表示されても入力を保持する。
	let answers = $state<Record<string, string>>(initialAnswers());
	/** 機密情報の入力欄には初期値を設定しない。 */
	function initialAnswers(): Record<string, string> {
		return Object.fromEntries(
			question.fields.map((field) => [
				field.id,
				field.secret === true ? "" : (field.prefill ?? ""),
			]),
		);
	}
	let error = $state<string | undefined>(undefined);
	/** 表示中の質問に回答し、拒否・取り消しの場合は回答本文を送らない。 */
	function respond(action: QuestionAnswer["action"]) {
		send({
			type: "question/respond",
			requestId: crypto.randomUUID(),
			questionId: question.id,
			sessionId: question.sessionId,
			runId: question.runId,
			action,
			answers: action === "accept" ? { ...answers } : {},
		});
	}
	/** 入力制約に違反した場合は、カードを閉じず修正を促す。 */
	function submit(event: SubmitEvent) {
		event.preventDefault();
		for (const field of question.fields) {
			const problem = questionFieldError(field, answers[field.id] ?? "");
			if (problem !== undefined) {
				error = `${field.title}: ${problem}`;
				return;
			}
		}
		error = undefined;
		respond("accept");
	}
</script>

<section
	class="question-card my-4 min-w-0 rounded-lg border border-solid border-panel-border bg-message-user p-4"
	aria-label={`${question.source}の質問`}
>
	<div class="mb-4 flex items-start gap-2">
		<MessageCircleQuestion
			size={16}
			class="mt-0.5 shrink-0 text-muted"
			aria-hidden="true"
		/>
		<div class="min-w-0">
			<p
				class="m-0 text-[13px] font-medium [overflow-wrap:anywhere] whitespace-pre-wrap"
			>
				{question.title}
			</p>
		</div>
	</div>
	<form onsubmit={submit} class="flex min-w-0 flex-col gap-4">
		{#each question.fields as field (field.id)}
			<QuestionField
				{field}
				group={`${question.id}:${field.id}`}
				bind:value={
					() => answers[field.id] ?? "",
					(value: string) => {
						answers[field.id] = value;
					}
				}
			/>
		{/each}
		{#if error ?? question.error}
			<p
				role="alert"
				class="m-0 text-[12px] [overflow-wrap:anywhere] text-tool-error"
			>
				{error ?? question.error}
			</p>
		{/if}
		<div class="flex flex-wrap gap-2">
			<button
				type="submit"
				class="primary border-transparent bg-primary text-primary-text"
				>回答を送信</button
			>
			{#if question.allowDecline === true}
				<button
					type="button"
					class="quiet group relative isolate overflow-hidden"
					onclick={() => respond("decline")}
					>拒否<ButtonCurtain
						name="拒否"
						className="bg-yellow-300"
					/></button
				>
			{/if}
			<button
				type="button"
				class="quiet group relative isolate overflow-hidden"
				onclick={() => respond("cancel")}
				>キャンセル<ButtonCurtain
					name="キャンセル"
					className="bg-red-300"
				/></button
			>
		</div>
	</form>
</section>

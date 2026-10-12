<!-- ツールの状態・停止操作・専用本文を表示し、手動の開閉を会話側に残す。 -->
<script lang="ts">
	import Square from "@lucide/svelte/icons/square";
	import X from "@lucide/svelte/icons/x";
	import ToolHeadingContent from "./ToolHeadingContent.svelte";
	import { mergeProps } from "bits-ui";
	import { taskActive, type AsyncTask } from "@nerita/shared/asyncTask";
	import type { ToolSummary } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import { isRecord } from "@nerita/shared/validation";
	import SettingsTooltip from "../SettingsTooltip.svelte";
	import { useCardExpansion } from "./ToolExpansion.svelte";
	import { toolRenderer } from "./toolRenderers.svelte";
	import ToolContent from "./ToolContent.svelte";
	import ToolHistoryContent from "./ToolHistoryContent.svelte";
	import OutputBody from "./OutputBody.svelte";
	import ThinkTool from "./ThinkTool.svelte";
	import ImageViewTool from "./ImageViewTool.svelte";
	import WebSearchTool from "./WebSearchTool.svelte";
	import ComboListCard from "./ComboListCard.svelte";
	import ToolCardCollapse from "./ToolCardCollapse.svelte";
	import { toolLabelClass } from "./toolStyles";
	import "../../ui/status-indicator.css";
	import "./toolCard.css";

	let {
		tool,
		task,
		cancelTurn = false,
		onStop,
		send,
		cwd: workspaceCwd,
	}: {
		tool: ToolSummary;
		task?: AsyncTask | undefined;
		cancelTurn?: boolean;
		onStop?: (() => void) | undefined;
		send?: ((message: UiMessage) => void) | undefined;
		cwd?: string | null | undefined;
	} = $props();
	const bodyId = $props.id();
	const expansion = useCardExpansion(() => tool);
	const renderer = $derived(toolRenderer(tool));
	const Icon = $derived(renderer.Icon);
	const Body = $derived(toolBody(tool, renderer));
	const status = $derived(cardStatus(tool, task));
	const active = $derived(status === "pending" || status === "in_progress");
	const executing = $derived(tool.kind === "execute");
	const progress = $derived(usesExecutionProgress(tool));
	const comboList = $derived(usesComboList(tool, Body));
	const reserveStatusSpace = $derived(
		status === "failed" || (executing && active),
	);
	const details = $derived(commandDetails(tool));

	/** バックグラウンドタスクの状態を要約より優先する。 */
	function cardStatus(
		value: ToolSummary,
		asyncTask: AsyncTask | undefined,
	): ToolSummary["status"] {
		if (asyncTask) {
			if (taskActive(asyncTask)) {
				return "in_progress";
			}
			if (asyncTask.state === "failed") {
				return "failed";
			}
			return "completed";
		}
		return value.backgrounded === true ? "in_progress" : value.status;
	}
	/** コマンドの作業ディレクトリと表示文を元の入力から取り出す。 */
	function commandDetails(value: ToolSummary) {
		const input = isRecord(value.rawInput) ? value.rawInput : {};
		const action = isRecord(input.action) ? input.action : input;
		return {
			cwd: typeof action.cwd === "string" ? action.cwd : value.cwd,
			command: commandLabel(input.command, value.title),
		};
	}
	/** 停止操作の対象と待機理由を利用者へ説明する。 */
	function stopTitle() {
		if (onStop) {
			return cancelTurn ? "現在のAI処理全体を停止" : "コマンドを停止";
		}
		return task?.stopPending === true
			? "停止を待っています"
			: "個別停止できるバックグラウンドタスクはありません";
	}

	/** 保存要約と制限済み出力を専用本文より優先する。 */
	function toolBody(
		value: ToolSummary,
		selected: ReturnType<typeof toolRenderer>,
	) {
		if (value.output) {
			return OutputBody;
		}
		if (value.summaryOnly === true) {
			return ToolHistoryContent;
		}
		return value.resultDisplay ? ToolContent : selected.Body;
	}
	/** 通常の推論・参照・検索だけを縦線付きの表示へ振り分ける。 */
	function usesComboList(
		value: ToolSummary,
		body: ReturnType<typeof toolBody>,
	) {
		if (body === ImageViewTool || body === WebSearchTool) {
			return true;
		}
		if (body !== ThinkTool) {
			return false;
		}
		const hasReview = [value.rawInput, value.rawOutput].some(
			(item) => isRecord(item) && isRecord(item.review),
		);
		return !hasReview;
	}
	/** 圧縮は停止ボタンを増やさず、コマンドと進行アイコンを共用する。 */
	function usesExecutionProgress(value: ToolSummary) {
		if (value.kind === "execute" || value.kind === "contextCompaction") {
			return true;
		}
		return (
			isRecord(value.rawItem) &&
			value.rawItem.type === "contextCompaction"
		);
	}
	/** 文字列と引数配列を表示用の一つの文へ揃える。 */
	function commandLabel(command: unknown, title: string) {
		if (typeof command === "string") {
			return command;
		}
		return Array.isArray(command) ? command.join(" ") : title;
	}
</script>

{#if comboList && Body}
	<ComboListCard
		tool={{ ...tool, status }}
		icon={Icon}
		open={expansion.open}
		{bodyId}
		onToggle={() => expansion.setOpen(!expansion.open)}
		><Body {tool} {send} cwd={workspaceCwd} /></ComboListCard
	>
{:else}
	<div
		class="tool-card my-[8px] overflow-hidden rounded-[6px] border border-solid border-panel-border"
		data-status={status}
		data-kind={tool.kind}
		data-open={expansion.open}
	>
		<div class="tool-header relative flex items-center">
			<SettingsTooltip content={tool.title}>
				{#snippet children({ props })}
					{#if Body}<button
							{...mergeProps(props, {
								onclick: () =>
									expansion.setOpen(!expansion.open),
							})}
							type="button"
							class="tool-heading group flex w-full min-w-0 items-center gap-[8px] rounded-none border-0 bg-transparent p-[10px] text-left hover:bg-menu-hover focus-visible:outline-offset-[-3px] data-highlighted:bg-menu-hover [&_svg]:shrink-0"
							aria-expanded={expansion.open}
							aria-controls={bodyId}
							><ToolHeadingContent
								{tool}
								{status}
								icon={Icon}
								{active}
								{progress}
								expandable={true}
								{reserveStatusSpace}
							/></button
						>
					{:else}<div
							{...props}
							class="tool-heading group flex w-full min-w-0 items-center gap-[8px] rounded-none border-0 bg-transparent p-[10px] text-left hover:bg-menu-hover [&_svg]:shrink-0"
						>
							<ToolHeadingContent
								{tool}
								{status}
								icon={Icon}
								{active}
								{progress}
								expandable={false}
								{reserveStatusSpace}
							/>
						</div>{/if}
				{/snippet}
			</SettingsTooltip>
			{#if status === "failed"}<span
					class="tool-result absolute right-[30px] inline-flex size-[26px] items-center justify-center text-tool-error"
					role="img"
					aria-label="失敗"><X size={16} aria-hidden="true" /></span
				>{/if}
			{#if executing && active}<SettingsTooltip content={stopTitle()}
					>{#snippet children({ props })}<button
							{...mergeProps(props, { onclick: onStop })}
							type="button"
							class="tool-stop absolute right-[30px] inline-flex size-[26px] items-center justify-center rounded-[5px] border border-solid border-tool-error/30 bg-tool-error/14 p-0 text-tool-error enabled:hover:bg-tool-error/12"
							aria-label={`${tool.title} を停止`}
							disabled={!onStop}
							><Square
								size={13}
								fill="currentColor"
								aria-hidden="true"
							/></button
						>{/snippet}</SettingsTooltip
				>{/if}
		</div>
		{#if Body}<ToolCardCollapse
				id={bodyId}
				className="tool-card-collapse"
				open={expansion.open}
			>
				{#if tool.summaryOnly === true || tool.nestedCallsIncomplete === true}<div
						class="px-[10px] pb-[8px] text-[12px] [overflow-wrap:anywhere] text-muted"
					>
						{#if tool.summaryOnly === true}<p class="m-0">
								保存された要約です。結果本文は保存されていません。
							</p>{/if}
						{#if tool.omittedArgumentBytes !== undefined}<p
								class="m-0"
							>
								入力はサイズ制限により省略されています（{tool.omittedArgumentBytes}
								バイト）。
							</p>{/if}
						{#if tool.nestedCallsIncomplete === true}<p class="m-0">
								入れ子のツール履歴は一部省略されています。
							</p>{/if}
					</div>{/if}
				<div
					class="tool-body border-0 border-t border-solid border-panel-border p-[12px] [&_section+section]:mt-[14px]"
				>
					{#if details.cwd}<div
							class="tool-cwd mb-[8px] text-[12px] [overflow-wrap:anywhere] text-muted"
						>
							<span class={toolLabelClass}>CWD</span>
							<div>{details.cwd}</div>
						</div>{/if}
					{#if tool.kind === "execute"}<pre
							class="tool-command m-0 mb-[12px] font-mono text-[12px] [overflow-wrap:anywhere] whitespace-pre-wrap">{details.command}</pre>{/if}
					<Body {tool} {send} cwd={workspaceCwd} />
				</div>
			</ToolCardCollapse>{/if}
	</div>
{/if}

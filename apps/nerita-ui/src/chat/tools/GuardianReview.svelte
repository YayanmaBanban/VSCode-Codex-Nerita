<!-- Guardian の構造化審査を表示し、未知の結果は汎用表示へ戻す。 -->
<script lang="ts">
	import type { ToolSummary } from "@nerita/shared/chatState";
	import { isRecord } from "@nerita/shared/validation";
	import ToolContent from "./ToolContent.svelte";
	import Value from "./Value.svelte";
	import { toolLabelClass } from "./toolStyles";

	let { tool }: { tool: ToolSummary } = $props();
	const sourceLabels: Record<string, string> = {
		model: "モデル審査",
		shared: "進行中の審査を共有",
		cache: "以前の判定を使用",
		prefetch: "先読みした判定を使用",
	};
	const input = $derived(isRecord(tool.rawInput) ? tool.rawInput : {});
	const output = $derived(isRecord(tool.rawOutput) ? tool.rawOutput : {});
	const review = $derived(
		isRecord(output.review) ? output.review : input.review,
	);
	const action = $derived(
		isRecord(output.action) ? output.action : input.action,
	);
	const fields = $derived.by(() => {
		if (!isRecord(review)) {
			return [];
		}
		const values: [string, unknown][] = [
			["審査 ID", review.id],
			["判断", review.status],
			["リスク", review.riskLevel],
			["ユーザーの承認", review.userAuthorization],
			["理由", review.rationale],
			["モデル", review.model],
			["判定取得時間（ms）", review.durationMs],
			["モデル審査時間（ms）", review.reviewDurationMs],
			[
				"判定の取得方法",
				typeof review.source === "string"
					? (sourceLabels[review.source] ?? review.source)
					: undefined,
			],
			["開始方法", review.prefetched === true ? "先読み" : undefined],
			["参照元の審査 ID", review.reusedFrom],
		];
		return values.filter(
			([, value]) => value !== null && value !== undefined,
		);
	});
</script>

{#if isRecord(review)}
	<dl class="guardian-fields m-0">
		{#each fields as [label, value] (label)}
			<div>
				<dt class="text-[12px] text-muted">{label}</dt>
				<dd class="m-0 mb-[10px]">
					<Value {value} />
				</dd>
			</div>
		{/each}
	</dl>
	{#if action !== undefined}
		<section>
			<h3 class={toolLabelClass}>対象操作</h3>
			<Value value={action} />
		</section>
	{/if}
{:else}
	<ToolContent {tool} />
{/if}

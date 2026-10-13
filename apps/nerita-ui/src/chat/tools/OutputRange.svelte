<!-- UTF-8 の現在範囲だけを取得し、閉じた後や古い要求への応答を破棄する。 -->
<script lang="ts">
	import type { Bridge } from "@nerita/shared/bridge";
	import { isNonEmptyString } from "@nerita/shared/valuePredicates";
	import {
		toolOutputChunkBytes,
		type ToolOutputResponse,
	} from "@nerita/shared/toolOutput";
	import ChevronLeft from "@lucide/svelte/icons/chevron-left";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import { mergeProps } from "bits-ui";
	import CommandOutput from "./CommandOutput.svelte";
	import SettingsTooltip from "../SettingsTooltip.svelte";

	let {
		id,
		outputRef,
		bridge,
	}: { id: string; outputRef: string; bridge: Bridge } = $props();
	let offset = $state(0);
	let previous = $state.raw<number[]>([]);
	let range = $state.raw<ToolOutputResponse>();
	let loading = $state(true);
	let error = $state<string>();
	let pending: string | undefined;
	const buttonClass =
		"inline-flex size-[28px] shrink-0 items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-muted enabled:hover:bg-settings-hover enabled:hover:text-foreground focus-visible:outline-1 focus-visible:outline-settings-focus disabled:opacity-40";

	/** 一範囲の要求と購読を同じ寿命で管理する。 */
	function observeOutputRange() {
		const reference = outputRef;
		const requestedOffset = offset;
		const requestId = crypto.randomUUID();
		pending = requestId;
		/** 要求 ID と出力参照の一致する応答だけを反映する。 */
		const receiveOutput: Parameters<Bridge["subscribe"]>[0] = (message) => {
			if (!("requestId" in message) || message.requestId !== pending) {
				return;
			}
			const matchingOutput =
				message.type === "tool/outputResult" &&
				message.outputRef === reference;
			if (matchingOutput) {
				range = message;
				error = message.error;
				loading = false;
			} else if (message.type === "request/failed") {
				error = message.error;
				loading = false;
			}
		};
		const unsubscribe = bridge.subscribe(receiveOutput);
		bridge.postMessage({
			type: "tool/output",
			requestId,
			outputRef: reference,
			offset: requestedOffset,
			limit: toolOutputChunkBytes,
		});
		return () => {
			pending = undefined;
			unsubscribe();
		};
	}
	// 描画対象の交換や出力の更新に合わせて DOM のサイズを監視し、旧監視を解除する。
	$effect(observeOutputRange);
	const unavailableRange = $derived(
		loading || isNonEmptyString(error) || !range,
	);
	const rangeReady = $derived(!loading && !isNonEmptyString(error));

	/** 操作直後に旧要求を無効化して、次の購読開始前の応答も捨てる。 */
	function prepare() {
		pending = undefined;
		loading = true;
		error = undefined;
		range = undefined;
	}

	/** 戻り先はオフセットだけを保存し、本文を積み重ねない。 */
	function showPrevious() {
		const next = previous.at(-1);
		if (next === undefined) {
			return;
		}
		prepare();
		offset = next;
		previous = previous.slice(0, -1);
	}

	/** 次の UTF-8 境界は Host が返した値を使う。 */
	function showNext() {
		if (!range) {
			return;
		}
		const next = range.nextOffset;
		prepare();
		previous = [...previous, offset];
		offset = next;
	}
</script>

<section {id} aria-label="詳細出力" aria-busy={loading}>
	{#if isNonEmptyString(error)}<p role="alert">
			{error}
		</p>{:else}<CommandOutput
			text={loading ? "読み込み中…" : (range?.text ?? "")}
			copyDisabled={loading || !range}
		/>{/if}
	<div class="flex items-center gap-[8px] text-[12px] text-muted">
		<SettingsTooltip content="前の範囲を表示"
			>{#snippet children({ props })}<button
					{...mergeProps(props, { onclick: showPrevious })}
					type="button"
					class={buttonClass}
					aria-label="前の範囲を表示"
					disabled={loading || previous.length === 0}
					><ChevronLeft size={16} aria-hidden="true" /></button
				>{/snippet}</SettingsTooltip
		>
		<SettingsTooltip content="次の範囲を表示"
			>{#snippet children({ props })}<button
					{...mergeProps(props, { onclick: showNext })}
					type="button"
					class={buttonClass}
					aria-label="次の範囲を表示"
					disabled={unavailableRange || range?.eof === true}
					><ChevronRight size={16} aria-hidden="true" /></button
				>{/snippet}</SettingsTooltip
		>
		{#if range && rangeReady}<span
				>{range.offset.toLocaleString()}–{range.nextOffset.toLocaleString()}
				バイト</span
			>{/if}
	</div>
</section>

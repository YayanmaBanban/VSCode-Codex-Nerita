// 可変高さの会話を仮想化し、画面外の移動先も行 ID で解決する。
import { onDestroy, untrack } from "svelte";
import { fromStore } from "svelte/store";
import { createVirtualizer, type SvelteVirtualizer } from "@tanstack/svelte-virtual";
import type { MessageTimeline } from "./messageTimeline";

/** 呼び出し側の runes と接続するため、変更可能な入力は getter で受け取る。 */
export function useConversationVirtualizer(
	timeline: () => MessageTimeline,
	conversation: () => HTMLElement | null,
	following: { current: boolean },
	sessionId: () => string | null,
) {
	let list = $state<HTMLDivElement | null>(null);
	let margin = $state(0);
	const focusFrame = { current: 0 };
	const session = $derived(sessionId());
	const store = createVirtualizer<HTMLElement, HTMLElement>({
		count: 0,
		getScrollElement: conversation,
		estimateSize: (index) => estimateRowHeight(timeline().entries[index]?.kind),
		getItemKey: (index) => timeline().entries[index]!.key,
		overscan: 5,
		followOnAppend: false,
	});
	const instance = fromStore(store);

	// 履歴と DOM の変化を外部 virtualizer の設定へ渡し、過去閲覧中の位置補正も更新する。
	$effect(() => {
		const data = timeline();
		const element = conversation();
		const scrollMargin = margin;
		untrack(() => {
			instance.current.setOptions({
				count: data.entries.length,
				getScrollElement: () => element,
				getItemKey: (index) => data.entries[index]!.key,
				scrollMargin,
			});
			instance.current.shouldAdjustScrollPositionOnItemSizeChange = (
				item,
				_delta,
				virtualizer,
			) =>
				!following.current &&
				item.end <= (virtualizer.scrollOffset ?? 0);
		});
	});
	// 会話の交換時は外部の高さキャッシュを捨て、再マウントされない行も DOM から測り直す。
	$effect(() => {
		void session;
		untrack(() => measureMountedRows(instance.current));
	});
	// 行数の変更後に DOM のリスト開始位置を測り、仮想行の配置へ反映する。
	$effect(() => {
		void timeline().entries.length;
		const root = conversation();
		if (root && list) {
			margin =
				list.getBoundingClientRect().top -
				root.getBoundingClientRect().top +
				root.scrollTop;
		}
	});
	onDestroy(() => cancelAnimationFrame(focusFrame.current));

	return {
		get virtualizer() {
			return instance.current;
		},
		get list() {
			return list;
		},
		set list(element: HTMLDivElement | null) {
			list = element;
		},
		reveal(key: string, focus = false) {
			const index = timeline().indexByKey.get(key);
			if (index === undefined) {
				return;
			}
			following.current = false;
			instance.current.scrollToIndex(index, {
				align: "start",
				behavior: "instant",
			});
			if (focus) {
				focusRow(conversation, key, focusFrame);
			}
		},
	};
}

/** メッセージ本文と見出しだけのツール行で、初期測定の高さを分ける。 */
function estimateRowHeight(kind: MessageTimeline["entries"][number]["kind"] | undefined) {
	return kind === "message" ? 180 : 64;
}

/** 高さキャッシュの破棄後も、再マウントされない表示中の行を測り直す。 */
function measureMountedRows(instance: SvelteVirtualizer<HTMLElement, HTMLElement>) {
	instance.measure();
	for (const node of instance.elementsCache.values()) {
		if (node.isConnected) { instance.measureElement(node); }
	}
}

/** 仮想行が描画されてから対応するメッセージへフォーカスを戻す。 */
function focusRow(
	conversation: () => HTMLElement | null,
	key: string,
	frame: { current: number },
) {
	cancelAnimationFrame(frame.current);
	let attempts = 0;
	const focus = () => {
		const row = conversation()?.querySelector<HTMLElement>(
			`[data-entry-key="${CSS.escape(key)}"]`,
		);
		if (row) {
			row.querySelector<HTMLElement>(".message")?.focus({
				preventScroll: true,
			});
		} else if (++attempts < 10) {
			frame.current = requestAnimationFrame(focus);
		}
	};
	frame.current = requestAnimationFrame(focus);
}

/** 描画・検索・復元が共有する仮想一覧の操作。 */
export type ConversationVirtualizer = ReturnType<
	typeof useConversationVirtualizer
>;

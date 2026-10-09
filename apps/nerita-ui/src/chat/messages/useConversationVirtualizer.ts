// 画面周辺の会話だけを描画し、画面外の移動先も行 ID で特定する。
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type RefObject,
} from "react";
import type { MessageTimeline } from "./messageTimeline";

/** 描画済みの行だけを計測し、可変高さの一覧をスクロール領域へ接続する。 */
export function useConversationVirtualizer(
	timeline: MessageTimeline,
	conversation: RefObject<HTMLElement | null>,
	following: RefObject<boolean>,
	sessionId: string | null,
) {
	const list = useRef<HTMLDivElement>(null);
	const [margin, setMargin] = useState(0);
	const getItemKey = useCallback(
		(index: number) => timeline.entries[index]!.key,
		[timeline],
	);
	const virtualizer = useVirtualizer({
		count: timeline.entries.length,
		getScrollElement: () => conversation.current,
		getItemKey,
		estimateSize: (index) =>
			timeline.entries[index]?.kind === "message" ? 180 : 64,
		overscan: 5,
		scrollMargin: margin,
		// 承認や進行状態を含む末尾への追従は `useFollowConversation` に集約する。
		followOnAppend: false,
	});
	virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (
		item,
		_delta,
		instance,
	) => !following.current && item.end <= (instance.scrollOffset ?? 0);
	useLayoutEffect(() => {
		virtualizer.measure();
	}, [sessionId, virtualizer]);
	useLayoutEffect(() => {
		// 高さキャッシュをリセットした場合も、再マウントされない表示中の行を再計測する。
		for (const node of virtualizer.elementsCache.values()) {
			if (node.isConnected) {
				virtualizer.measureElement(node);
			}
		}
	});
	useLayoutEffect(() => {
		const element = conversation.current;
		if (!element || !list.current) {
			return;
		}
		setMargin(
			list.current.getBoundingClientRect().top -
				element.getBoundingClientRect().top +
				element.scrollTop,
		);
	}, [conversation, timeline.entries.length]);
	const reveal = useCallback(
		(key: string, focus = false) => {
			const index = timeline.indexByKey.get(key);
			if (index === undefined) {
				return;
			}
			following.current = false;
			virtualizer.scrollToIndex(index, {
				align: "start",
				behavior: "instant",
			});
			if (focus) {
				focusRow(conversation.current, key);
			}
		},
		[timeline, following, virtualizer, conversation],
	);
	return useMemo(
		() => ({ virtualizer, list, reveal }),
		[virtualizer, reveal],
	);
}

/** 描画範囲への移動が反映されてから、回答に対応する送信文へフォーカスを戻す。 */
function focusRow(root: HTMLElement | null, key: string) {
	let attempts = 0;
	const focus = () => {
		const row = root?.querySelector<HTMLElement>(
			`[data-entry-key="${CSS.escape(key)}"]`,
		);
		if (row) {
			row.querySelector<HTMLElement>(".message")?.focus({
				preventScroll: true,
			});
		} else if (++attempts < 10) {
			requestAnimationFrame(focus);
		}
	};
	requestAnimationFrame(focus);
}

/** 描画と検索から使う仮想一覧の操作。 */
export type ConversationVirtualizer = ReturnType<
	typeof useConversationVirtualizer
>;

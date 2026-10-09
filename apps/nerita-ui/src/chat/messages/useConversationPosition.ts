// 行の高さや表示幅が変わっても、読んでいた行を基準に位置を復元する。
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { ConversationScrollAnchor } from "@nerita/shared/conversationScroll";
import type { useChatView } from "../useChatView";
import type { ConversationVirtualizer } from "./useConversationVirtualizer";

/** Host へ渡す表示位置を記録し、表示幅が変わったときに行の高さと表示位置を更新する。 */
export function useConversationPosition(
	view: ReturnType<typeof useChatView>,
	virtual: ConversationVirtualizer,
	sessionId: string | null,
	following: RefObject<boolean>,
) {
	const { scrollAnchor: scrollAnchorRef, conversation } = view;
	const applied = useRef<typeof view.restore>(null);
	useLayoutEffect(() => {
		scrollAnchorRef.current = () =>
			capturePosition(conversation.current, sessionId);
		return () => {
			scrollAnchorRef.current = () => undefined;
		};
	}, [scrollAnchorRef, conversation, sessionId]);
	useEffect(() => {
		const restore = view.restore;
		const root = view.conversation.current;
		if (!restore || restore === applied.current || !root) {
			return;
		}
		if (
			restore.scrollAnchor &&
			restore.scrollAnchor.sessionId !== sessionId
		) {
			return;
		}
		if (
			restore.scrollAnchor &&
			!canRestore(restore.scrollAnchor, virtual)
		) {
			return;
		}
		applied.current = restore;
		if (restore.scrollAnchor) {
			return restorePosition(
				root,
				virtual,
				restore.scrollAnchor,
				following,
			);
		}
		const frame = requestAnimationFrame(() => {
			root.scrollTop = restore.scrollTop;
		});
		return () => cancelAnimationFrame(frame);
	}, [view.restore, view.conversation, virtual, sessionId, following]);
	useConversationWidth(view.conversation, virtual, following, sessionId);
}

/** 画面外の行への復元は会話データが届くまで待つ。 */
function canRestore(
	anchor: ConversationScrollAnchor,
	virtual: ConversationVirtualizer,
) {
	return anchor.entryKey === null || virtual.virtualizer.options.count > 0;
}

/** 画面内の先頭の行と、スクロール領域内での上端位置を記録する。 */
function capturePosition(
	root: HTMLElement | null,
	sessionId: string | null,
): ConversationScrollAnchor | undefined {
	if (!root) {
		return undefined;
	}
	const top = root.getBoundingClientRect().top;
	const rows = Array.from(
		root.querySelectorAll<HTMLElement>("[data-entry-key]"),
	);
	// 承認欄など一覧より下を読んでいる場合も、最後の行からの位置で引き継ぐ。
	const row =
		rows.find((element) => element.getBoundingClientRect().bottom > top) ??
		rows.at(-1);
	return {
		sessionId,
		entryKey: row?.dataset.entryKey ?? null,
		offset: row ? row.getBoundingClientRect().top - top : 0,
		atEnd: root.scrollHeight - root.clientHeight - root.scrollTop <= 4,
	};
}

/** 推定位置へ移動した後、描画・計測に伴うずれを後続のフレームで実際の行位置に合わせて補正する。 */
function restorePosition(
	root: HTMLElement,
	virtual: ConversationVirtualizer,
	anchor: ConversationScrollAnchor,
	following: RefObject<boolean>,
) {
	following.current = anchor.atEnd;
	if (anchor.entryKey !== null && !anchor.atEnd) {
		virtual.reveal(anchor.entryKey);
	}
	let frame = 0;
	let attempts = 0;
	const align = () => {
		if (anchor.atEnd) {
			root.scrollTop = root.scrollHeight;
		} else if (anchor.entryKey !== null) {
			const row = root.querySelector<HTMLElement>(
				`[data-entry-key="${CSS.escape(anchor.entryKey)}"]`,
			);
			if (row) {
				root.scrollTop +=
					row.getBoundingClientRect().top -
					root.getBoundingClientRect().top -
					anchor.offset;
			}
		}
		if (++attempts < 12) {
			frame = requestAnimationFrame(align);
		}
	};
	const cancel = () => cancelAnimationFrame(frame);
	root.addEventListener("wheel", cancel, { passive: true });
	root.addEventListener("pointerdown", cancel);
	root.addEventListener("keydown", cancel);
	frame = requestAnimationFrame(align);
	return () => {
		cancel();
		root.removeEventListener("wheel", cancel);
		root.removeEventListener("pointerdown", cancel);
		root.removeEventListener("keydown", cancel);
	};
}

/** 折り返し幅が変わった場合は、画面外の古い高さを使い続けない。 */
export function useConversationWidth(
	rootRef: RefObject<HTMLElement | null>,
	virtual: ConversationVirtualizer,
	following: RefObject<boolean>,
	sessionId: string | null,
) {
	useEffect(() => {
		const root = rootRef.current;
		if (!root) {
			return;
		}
		let width = root.clientWidth;
		let dispose: (() => void) | undefined;
		const observer = new ResizeObserver(() => {
			if (root.clientWidth === width || root.clientWidth === 0) {
				return;
			}
			width = root.clientWidth;
			const item = virtual.virtualizer.getVirtualItemForOffset(
				root.scrollTop,
			);
			const anchor = {
				sessionId,
				entryKey: typeof item?.key === "string" ? item.key : null,
				offset: item ? item.start - root.scrollTop : 0,
				atEnd: following.current,
			};
			virtual.virtualizer.measure();
			dispose?.();
			dispose = restorePosition(root, virtual, anchor, following);
		});
		observer.observe(root);
		return () => {
			observer.disconnect();
			dispose?.();
		};
	}, [rootRef, virtual, following, sessionId]);
}

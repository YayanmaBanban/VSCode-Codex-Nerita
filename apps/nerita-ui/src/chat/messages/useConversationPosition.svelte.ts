// 行の高さや表示幅が変わっても、読んでいた行を基準に会話位置を復元する。
import { untrack } from "svelte";
import type { ConversationScrollAnchor } from "@nerita/shared/conversationScroll";
import type { ConversationVirtualizer } from "./useConversationVirtualizer.svelte";

/** Host が保存した表示位置。別のセッションのアンカーは適用しない。 */
type ConversationRestore = {
	scrollTop: number;
	scrollAnchor?: ConversationScrollAnchor | undefined;
};
/** 呼び出し側が保持する会話 DOM と復元要求に getter で接続する。 */
type PositionView = {
	readonly conversation: HTMLElement | null;
	readonly restore: ConversationRestore | null;
	scrollAnchor: () => ConversationScrollAnchor | undefined;
};

/** 元データの準備を待って一度復元し、Host に渡す位置の取得関数を提供する。 */
export function useConversationPosition(
	view: PositionView,
	virtual: ConversationVirtualizer,
	sessionId: () => string | null,
	following: { current: boolean },
) {
	let applied: ConversationRestore | null = null;
	const session = $derived(sessionId());
	// 会話の交換時に保存用の DOM 読み取り窓口を差し替え、破棄後は旧会話を保存しない。
	$effect(() => {
		const currentSession = session;
		view.scrollAnchor = () =>
			capturePosition(view.conversation, currentSession);
		return () => {
			view.scrollAnchor = () => undefined;
		};
	});
	/** 復元要求を一度だけ適用し、計測中の行が届くまで待つ。 */
	function restoreConversationPosition() {
		const restore = view.restore;
		const root = view.conversation;
		const count = virtual.virtualizer.options.count;
		if (!restore || restore === applied || !root) {
			return;
		}
		const anchor = restore.scrollAnchor;
		if (anchor && !canRestore(anchor, session, count)) {
			return;
		}
		applied = restore;
		if (anchor) {
			return untrack(() =>
				restorePosition(root, virtual, anchor, following),
			);
		}
		const frame = requestAnimationFrame(() => {
			root.scrollTop = restore.scrollTop;
		});
		return () => cancelAnimationFrame(frame);
	}
	// 復元対象の行が描画されてからスクロールを適用し、要求の変更では旧フレームを取り消す。
	$effect(restoreConversationPosition);
	useConversationWidth(
		() => view.conversation,
		virtual,
		following,
		sessionId,
	);
}

/** 別の会話と未到着の行のアンカーを適用しない。 */
function canRestore(
	anchor: ConversationScrollAnchor,
	sessionId: string | null,
	count: number,
) {
	if (anchor.sessionId !== sessionId) {
		return false;
	}
	return anchor.entryKey === null || count > 0;
}

/** 先頭の表示行と末尾追従を記録し、承認欄など一覧外の位置にも対応する。 */
function capturePosition(
	root: HTMLElement | null,
	sessionId: string | null,
): ConversationScrollAnchor | undefined {
	if (!root) {
		return undefined;
	}
	const top = root.getBoundingClientRect().top;
	const rows = [...root.querySelectorAll<HTMLElement>("[data-entry-key]")];
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

/** 計測後のずれを後続フレームで補正し、人が操作したら補正を中止する。 */
function restorePosition(
	root: HTMLElement,
	virtual: ConversationVirtualizer,
	anchor: ConversationScrollAnchor,
	following: { current: boolean },
) {
	following.current = anchor.atEnd;
	if (anchor.entryKey !== null && !anchor.atEnd) {
		virtual.reveal(anchor.entryKey);
	}
	let frame = 0;
	let attempts = 0;
	/** 描画を待ちながら保存した行位置または会話末尾へ復元し、試行回数を上限で打ち切る。 */
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
	/** 会話位置の復元予約を取り消し、旧画面への補正が続かないようにする。 */
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

/** 折り返し幅が変わると高さキャッシュを破棄し、変化前の表示行を維持する。 */
export function useConversationWidth(
	getRoot: () => HTMLElement | null,
	virtual: ConversationVirtualizer,
	following: { current: boolean },
	sessionId: () => string | null,
) {
	const session = $derived(sessionId());
	/** 表示幅の監視はセッション変更と DOM の取り替え時だけ作り直す。 */
	function observeConversationWidth() {
		const root = getRoot();
		const currentSession = session;
		if (!root) {
			return;
		}
		let width = root.clientWidth;
		let frame = 0;
		let dispose: (() => void) | undefined;
		/** 幅の変化で仮想リストを再計測し、表示中の行を基準にスクロール位置を維持する。 */
		const updateWidth = () => {
			if (root.clientWidth === width || root.clientWidth === 0) {
				return;
			}
			width = root.clientWidth;
			const item = virtual.virtualizer.getVirtualItemForOffset(
				root.scrollTop,
			);
			const anchor = {
				sessionId: currentSession,
				entryKey: typeof item?.key === "string" ? item.key : null,
				offset: item ? item.start - root.scrollTop : 0,
				atEnd: following.current,
			};
			virtual.virtualizer.measure();
			dispose?.();
			dispose = restorePosition(root, virtual, anchor, following);
		};
		// 再計測でスクロールバーの有無も変わるため、サイズ通知中にはレイアウトを更新しない。
		const observer = new ResizeObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(updateWidth);
		});
		observer.observe(root);
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
			dispose?.();
		};
	}
	// 会話 DOM の幅変更を監視して仮想行を再計測し、監視対象の交換では解除する。
	$effect(observeConversationWidth);
}

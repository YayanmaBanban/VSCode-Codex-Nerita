// 元の会話データを検索し、描画中の一致だけを強調する。
import { tick, untrack } from "svelte";
import type { MessageTimeline } from "../messages/messageTimeline";
import type { ConversationVirtualizer } from "../messages/useConversationVirtualizer.svelte";
import type { ToolExpansionState } from "../tools/ToolExpansion.svelte";
import { searchPattern, type FindOptions } from "./findMatches";
import { searchTimeline, type SearchHit } from "./searchTimeline";
import { useSearchHighlights } from "./useSearchHighlights.svelte";

/** 元データ検索と表示行の強調に共用する結果。 */
type SearchData = {
	hits: SearchHit[];
	pattern: RegExp | null;
	limited: boolean;
	error: string;
};

/** UI ツリーごとに作り、旧要求と閉じた DOM の寿命を外へ持ち出さない。 */
class ConversationSearch {
	open = $state(false);
	query = $state("");
	options = $state.raw<FindOptions>({
		caseSensitive: false,
		wholeWord: false,
		regex: false,
	});
	found = $state.raw<SearchData>({
		hits: [],
		pattern: null,
		limited: false,
		error: "",
	});
	index = $state(0);
	selection = $state(0);
	reveal = { current: false };
	previous: { query: string; options: FindOptions | undefined } = {
		query: "",
		options: undefined,
	};
	input: HTMLInputElement | null = null;
	previousFocus: HTMLElement | null = null;
	conversation: () => HTMLElement | null;
	timeline: () => MessageTimeline;
	virtual: ConversationVirtualizer;
	expansion: ToolExpansionState;

	/** 入力 getter を画面の寿命に接続し、各監視の終了処理を登録する。 */
	constructor(
		conversation: () => HTMLElement | null,
		timeline: () => MessageTimeline,
		virtual: ConversationVirtualizer,
		expansion: ToolExpansionState,
	) {
		this.conversation = conversation;
		this.timeline = timeline;
		this.virtual = virtual;
		this.expansion = expansion;
		// 検索条件と履歴の変更を遅延検索へ渡し、次の変更や破棄では旧タイマーを取り消す。
		$effect(() => this.scheduleSearch());
		// 検索結果の選択に合わせ、画面外の仮想行を描画してスクロールする。
		$effect(() => this.revealSelection());
		// 検索バーを開いた後の DOM 更新を待ってフォーカスし、閉じた後の遅延処理を失効させる。
		$effect(() => this.focusInput());
		// この controller の寿命でエディターより先にキーを捕捉し、破棄時に window の監視を外す。
		$effect(() => this.observeKeyboard());
		useSearchHighlights(
			conversation,
			() => this.open,
			() => this.found.pattern,
			() => this.active,
			this.reveal,
			() => this.selection,
		);
	}

	/** 元データ上の現在の一致を返し、画面外でも選択を保つ。 */
	get active() {
		return this.found.hits[this.index];
	}
	/** 検索バーが読み上げる件数と入力エラーを返す。 */
	get result() {
		return {
			count: this.found.hits.length,
			index: this.index,
			limited: this.found.limited,
			error: this.found.error,
		};
	}

	/** 条件変更時は先頭へ戻し、逐次更新では一致番号を保つ。 */
	scheduleSearch() {
		const visible = this.open;
		const query = this.query;
		const options = this.options;
		const timeline = this.timeline();
		if (!visible) {
			this.found = { hits: [], pattern: null, limited: false, error: "" };
			return;
		}
		const reset =
			this.previous.query !== query || this.previous.options !== options;
		const timer = setTimeout(
			() => this.search(query, options, timeline, reset),
			reset ? 250 : 120,
		);
		return () => clearTimeout(timer);
	}

	/** 遅延した検索だけが現在の表示へ反映される。 */
	search(
		query: string,
		options: FindOptions,
		timeline: MessageTimeline,
		reset: boolean,
	) {
		try {
			this.previous = { query, options };
			const pattern = searchPattern(query, options);
			const result = pattern
				? searchTimeline(timeline.entries, pattern)
				: { hits: [], limited: false };
			this.found = { ...result, pattern, error: "" };
			this.index = reset
				? 0
				: Math.min(this.index, Math.max(0, result.hits.length - 1));
			this.reveal.current = reset;
		} catch {
			this.found = {
				hits: [],
				pattern: null,
				limited: false,
				error: "正規表現が正しくありません。",
			};
		}
	}

	/** 本文を検索したツールだけを開き、画面外の行を描画する。 */
	revealSelection() {
		const hit = this.active;
		const visible = this.open;
		const timeline = this.timeline();
		void this.selection;
		if (!visible || !hit || !this.reveal.current) {
			return;
		}
		untrack(() => {
			const entry =
				timeline.entries[timeline.indexByKey.get(hit.entryKey) ?? -1];
			const closedTool =
				entry?.kind === "tool" && !this.expansion.open.has(entry.key);
			if (hit.body && closedTool) {
				this.expansion.setOpen(entry.tool, true);
			}
			this.virtual.reveal(hit.entryKey);
		});
	}

	/** 検索バーが描画された後に入力へフォーカスを移す。 */
	focusInput() {
		if (!this.open) {
			return;
		}
		let current = true;
		void tick().then(() => {
			if (current) {
				this.input?.focus();
				this.input?.select();
			}
		});
		return () => {
			current = false;
		};
	}

	/** エディターのキー処理より先に捕捉し、破棄時に解除する。 */
	observeKeyboard() {
		/** 会話欄のキー操作を検索の操作へ接続し、登録と解除で同じハンドラーを使う。 */
		const onKey = (event: KeyboardEvent) => this.handleKey(event);
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}

	/** IME 確定操作を通し、検索を開く操作と移動を分ける。 */
	handleKey(event: KeyboardEvent) {
		if (event.isComposing) {
			return;
		}
		if (isOpenSearchKey(event)) {
			event.preventDefault();
			event.stopPropagation();
			if (!this.open) {
				this.captureFocusAndQuery();
			}
			this.open = true;
			this.input?.focus();
			this.input?.select();
			return;
		}
		if (this.open && isMoveSearchKey(event)) {
			event.preventDefault();
			event.stopPropagation();
			this.move(event.shiftKey ? -1 : 1);
		}
	}

	/** 初めて開く時だけ会話の選択文字と復帰先を保存する。 */
	captureFocusAndQuery() {
		this.previousFocus =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const selected = window.getSelection();
		if (!selected?.anchorNode) {
			return;
		}
		if (this.conversation()?.contains(selected.anchorNode) !== true) {
			return;
		}
		const text = selected.toString();
		if (text !== "") {
			this.query = text;
		}
	}

	/** 一致番号を循環し、同じ行への再移動も通知する。 */
	move = (direction: number) => {
		if (this.found.hits.length === 0) {
			return;
		}
		this.index =
			(this.index + direction + this.found.hits.length) %
			this.found.hits.length;
		this.selection++;
		const hit = this.found.hits[this.index];
		if (!hit) {
			return;
		}
		this.reveal.current = true;
		this.virtual.reveal(hit.entryKey);
	};

	/** 開いた時の編集位置へフォーカスを戻す。 */
	close = () => {
		this.open = false;
		if (this.previousFocus?.isConnected === true) {
			this.previousFocus.focus({ preventScroll: true });
		} else {
			this.conversation()?.focus({ preventScroll: true });
		}
		this.previousFocus = null;
	};

	/** 編集された検索語は遅延した再検索へ渡す。 */
	setQuery(value: string) {
		this.query = value;
	}
	/** 条件の参照を更新して一致番号を先頭へ戻す。 */
	setOptions(value: FindOptions) {
		this.options = value;
	}
	/** 入力のマウントと破棄に合わせてフォーカス先を登録する。 */
	setInput(element: HTMLInputElement | null) {
		this.input = element;
	}
}

/** 会話内検索を開く Ctrl/Cmd+F を判定する。 */
function isOpenSearchKey(event: KeyboardEvent) {
	const modifier = event.ctrlKey || event.metaKey;
	if (!modifier || event.altKey || event.shiftKey) {
		return false;
	}
	return event.key.toLowerCase() === "f";
}

/** F3 または Ctrl/Cmd+G の一致移動を判定する。 */
function isMoveSearchKey(event: KeyboardEvent) {
	if (event.key === "F3") {
		return true;
	}
	const modifier = event.ctrlKey || event.metaKey;
	return modifier && event.key.toLowerCase() === "g";
}

/** 変更可能な入力は getter として受け取り、画面ごとの状態を返す。 */
export function useChatSearch(
	conversation: () => HTMLElement | null,
	timeline: () => MessageTimeline,
	virtual: ConversationVirtualizer,
	expansion: ToolExpansionState,
) {
	return new ConversationSearch(conversation, timeline, virtual, expansion);
}
/** 会話内検索の状態と操作。利用側は検索欄と会話の表示要素を接続し、破棄時に監視を解除する。 */
export type ChatSearch = ReturnType<typeof useChatSearch>;

// 手動で過去を読んでいる位置を守り、末尾にいる間だけ内容の追加へ追従する。
import { isNonZeroNumber } from "@nerita/shared/valuePredicates";
import { untrack } from "svelte";

/** 会話末尾への追従を登録する。Svelte の寿命管理内で呼び出し、表示要素と会話 ID は最新値を返す関数で渡す。 */
export function useFollowConversation(
	container: () => HTMLElement | null,
	sessionId: () => string | null,
	paused: () => boolean,
	sharedFollowing?: { current: boolean },
) {
	const localFollowing = { current: true };
	const following = sharedFollowing ?? localFollowing;
	// Host スナップショットの参照変更と、実際のセッション切り替えを分ける。
	const session = $derived(sessionId());
	const pause = $derived(paused());
	// 追従フラグはスクロール監視とも共有するため、会話が変わった時だけ初期化する。
	$effect(() => {
		void session;
		untrack(() => {
			following.current = true;
		});
	});
	/** 手動の縦移動とブラウザの高さ補正を分け、監視とフレーム予約は破棄時に回収する。 */
	const observeConversationFollowing = () => {
		const element = container();
		if (!element) {
			return;
		}
		let previous = scrollMetrics(element);
		let frame = 0;
		const toolScroll = registerToolCardScroll(element, () => {
			following.current = false;
		});
		/** ブラウザーの小数点誤差を許容して、会話欄が末尾にあるかを判定する。 */
		const atBottom = () =>
			element.scrollHeight - element.clientHeight - element.scrollTop <=
			4;
		/** 手動スクロールやツール展開を妨げない条件で、会話欄を末尾へ追従させる。 */
		const follow = () => {
			if (following.current && !pause && !toolScroll.active()) {
				element.scrollTo({ top: element.scrollHeight });
				previous = scrollMetrics(element);
			}
		};
		/** 表示の高さ変化による位置補正を除き、利用者のスクロールに応じて末尾への追従を切り替える。 */
		const scroll = () => {
			// サブエージェントの表示中に会話欄が隠れたことによる位置変化は、手動操作として扱わない。
			if (!isNonZeroNumber(element.clientHeight) || toolScroll.active()) {
				return;
			}
			if (atBottom()) {
				following.current = true;
			} else if (scrolledUpWithoutResize(element, previous)) {
				// 高さの変化によるブラウザの位置補正は手動操作とみなさない。
				following.current = false;
			}
			previous = scrollMetrics(element);
		};
		// `wheel` 直後の描画更新が、ブラウザの `scroll` 通知より先に追従する競合を防ぐ。
		const wheel = (event: WheelEvent) => {
			if (event.deltaY < 0 && element.scrollTop > 0) {
				following.current = false;
			}
		};
		/** 既存の追従予約を取り消し、次の描画で一度だけ会話末尾へ移動する。 */
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(follow);
		};
		const stopObserving = observeConversation(element, schedule);
		element.addEventListener("scroll", scroll);
		element.addEventListener("wheel", wheel, { passive: true });
		follow();
		return () => {
			toolScroll.dispose();
			cancelAnimationFrame(frame);
			stopObserving();
			element.removeEventListener("scroll", scroll);
			element.removeEventListener("wheel", wheel);
		};
	};
	// 会話の交換と追従の休止・再開に合わせ、DOM の監視とフレーム予約を張り替える。
	$effect(() => {
		void session;
		void pause;
		// 追従フラグの変更では監視を張り替えず、直前の高さと位置の記録を保つ。
		return untrack(observeConversationFollowing);
	});
}

/** 会話欄とその内容の高さ、行や本文の変更を監視し、末尾への追従処理を次のフレームに予約する。 */
function observeConversation(element: HTMLElement, schedule: () => void) {
	const resize = new ResizeObserver(schedule);
	/** 会話欄とその子要素の高さを監視し直し、追従する位置の再計算を予約する。 */
	const observe = () => {
		resize.disconnect();
		resize.observe(element);
		for (const child of element.children) {
			resize.observe(child);
		}
		schedule();
	};
	const mutation = new MutationObserver(observe);
	mutation.observe(element, {
		childList: true,
		subtree: true,
		characterData: true,
	});
	observe();
	return () => {
		resize.disconnect();
		mutation.disconnect();
	};
}

/** カードを開く前の見出し位置を保ち、展開中は会話末尾への自動スクロールを止める。 */
function registerToolCardScroll(container: HTMLElement, onOpen: () => void) {
	let heading: HTMLElement | null = null;
	let headingOffset = 0;
	let frame = 0;
	/** ツール展開に合わせた位置補正の予約を取り消し、対象の見出しを解除する。 */
	const cancel = () => {
		cancelAnimationFrame(frame);
		heading = null;
	};
	/** ツールの展開中だけ、開く操作をした見出しの画面内位置を維持する。 */
	const align = () => {
		if (!(heading?.isConnected === true)) {
			cancel();
			return;
		}
		if (heading.getAttribute("aria-expanded") !== "true") {
			cancel();
			return;
		}
		container.scrollTop +=
			heading.getBoundingClientRect().top -
			container.getBoundingClientRect().top -
			headingOffset;
		const collapse = heading
			.closest(".tool-card")
			?.querySelector(".tool-card-collapse, .combo-list-collapse");
		// スクロールの自動補正で見出しが動いても、展開完了まではクリック時の位置へ戻す。
		const matchesSome =
			collapse
				?.getAnimations()
				.some((animation) => animation.playState !== "finished") ===
			true;
		if (matchesSome) {
			frame = requestAnimationFrame(align);
		} else {
			heading = null;
		}
	};
	/** 開く対象の見出しと位置を記録し、展開時の自動追従を止めて位置補正を予約する。 */
	const click = (event: MouseEvent) => {
		const target =
			event.target instanceof Element
				? event.target.closest<HTMLElement>(
						".tool-heading[aria-expanded='false']",
					)
				: null;
		if (!target || !container.contains(target)) {
			return;
		}
		cancel();
		heading = target;
		headingOffset =
			target.getBoundingClientRect().top -
			container.getBoundingClientRect().top;
		onOpen();
		frame = requestAnimationFrame(align);
	};
	// UI の開閉処理より先に末尾への追従を止める。キーボード操作によるボタンの実行も対象とする。
	container.addEventListener("click", click, true);
	container.addEventListener("wheel", cancel, { passive: true });
	container.addEventListener("pointerdown", cancel);
	container.addEventListener("keydown", cancel);
	return {
		active: () => heading !== null,
		dispose: () => {
			cancel();
			container.removeEventListener("click", click, true);
			container.removeEventListener("wheel", cancel);
			container.removeEventListener("pointerdown", cancel);
			container.removeEventListener("keydown", cancel);
		},
	};
}

/** 会話欄の位置と高さを同じ順序で記録する。 */
function scrollMetrics(element: HTMLElement) {
	return {
		top: element.scrollTop,
		height: element.scrollHeight,
		viewport: element.clientHeight,
	};
}

/** 高さが変わらずに位置だけ上がった場合を手動スクロールとして扱う。 */
function scrolledUpWithoutResize(
	element: HTMLElement,
	previous: ReturnType<typeof scrollMetrics>,
) {
	return (
		element.scrollTop < previous.top &&
		element.scrollHeight === previous.height &&
		element.clientHeight === previous.viewport
	);
}

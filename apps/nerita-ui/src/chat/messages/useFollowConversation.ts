// 手動で過去を読んでいる位置を守り、末尾にいる間だけ内容の追加へ追従する。
import { isNonZeroNumber } from "@nerita/shared/valuePredicates";
import { useLayoutEffect, useRef, type RefObject } from "react";

export function useFollowConversation(
	container: RefObject<HTMLElement | null>,
	sessionId: string | null,
	paused: boolean,
	sharedFollowing?: RefObject<boolean>,
) {
	const localFollowing = useRef(true);
	const following = sharedFollowing ?? localFollowing;
	useLayoutEffect(() => {
		following.current = true;
	}, [sessionId, following]);
	useLayoutEffect(() => {
		const element = container.current;
		if (!element) {
			return;
		}
		let previousTop = element.scrollTop;
		let frame = 0;
		const toolScroll = registerToolCardScroll(element, () => {
			following.current = false;
		});
		const atBottom = () =>
			element.scrollHeight - element.clientHeight - element.scrollTop <=
			4;
		const follow = () => {
			if (following.current && !paused && !toolScroll.active()) {
				element.scrollTo({ top: element.scrollHeight });
				previousTop = element.scrollTop;
			}
		};
		const scroll = () => {
			// サブエージェントの表示中に会話欄が隠れたことによる位置変化は、手動操作として扱わない。
			if (!isNonZeroNumber(element.clientHeight) || toolScroll.active()) {
				return;
			}
			if (atBottom()) {
				following.current = true;
			} else if (element.scrollTop < previousTop) {
				following.current = false;
			}
			previousTop = element.scrollTop;
		};
		// `wheel` 直後の描画更新が、ブラウザの `scroll` 通知より先に追従する競合を防ぐ。
		const wheel = (event: WheelEvent) => {
			if (event.deltaY < 0 && element.scrollTop > 0) {
				following.current = false;
			}
		};
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(follow);
		};
		const resize = new ResizeObserver(schedule);
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
		element.addEventListener("scroll", scroll);
		element.addEventListener("wheel", wheel, { passive: true });
		observe();
		follow();
		return () => {
			toolScroll.dispose();
			cancelAnimationFrame(frame);
			resize.disconnect();
			mutation.disconnect();
			element.removeEventListener("scroll", scroll);
			element.removeEventListener("wheel", wheel);
		};
	}, [container, sessionId, paused, following]);
}

/** カードを開く前の見出し位置を保ち、展開中は会話末尾への自動スクロールを止める。 */
function registerToolCardScroll(container: HTMLElement, onOpen: () => void) {
	let heading: HTMLElement | null = null;
	let headingOffset = 0;
	let frame = 0;
	const cancel = () => {
		cancelAnimationFrame(frame);
		heading = null;
	};
	const align = () => {
		if (
			!(heading?.isConnected === true) ||
			heading.getAttribute("aria-expanded") !== "true"
		) {
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
		if (
			collapse
				?.getAnimations()
				.some((animation) => animation.playState !== "finished") ===
			true
		) {
			frame = requestAnimationFrame(align);
		} else {
			heading = null;
		}
	};
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
	// React の開閉処理より先に末尾への追従を止める。キーボード操作によるボタンの実行も対象とする。
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

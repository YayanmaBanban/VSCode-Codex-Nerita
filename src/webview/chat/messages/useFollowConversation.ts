// 手動で過去を読んでいる位置を守り、末尾にいる間だけ内容の伸長へ追従する。
import { useLayoutEffect, useRef, type RefObject } from "react";

export function useFollowConversation(
	container: RefObject<HTMLElement | null>,
	sessionId: string | null,
	paused: boolean,
) {
	const following = useRef(true);
	useLayoutEffect(() => {
		following.current = true;
	}, [sessionId]);
	useLayoutEffect(() => {
		const element = container.current;
		if (!element) {
			return;
		}
		let previousTop = element.scrollTop;
		let frame = 0;
		const atBottom = () =>
			element.scrollHeight - element.clientHeight - element.scrollTop <=
			4;
		const follow = () => {
			if (following.current && !paused) {
				element.scrollTop = element.scrollHeight;
				previousTop = element.scrollTop;
			}
		};
		const scroll = () => {
			// サブエージェント表示中の非表示化による位置変化は手動操作と扱わない。
			if (!element.clientHeight) {
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
			cancelAnimationFrame(frame);
			resize.disconnect();
			mutation.disconnect();
			element.removeEventListener("scroll", scroll);
			element.removeEventListener("wheel", wheel);
		};
	}, [container, sessionId, paused]);
}

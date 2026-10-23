// Storybook の描画要素にだけ公開した通信窓口を、操作検証から取得する。
import type { StoryBridge } from "./mocks/storyBridge";

/** 操作後の送信内容と Host の通知を検証する。 */
export function storyBridge(canvas: HTMLElement): StoryBridge {
	const element = canvas.querySelector<
		HTMLElement & { storyBridge: StoryBridge }
	>("[data-story-chat]");
	if (!element) {
		throw new Error("StoryChat is not mounted");
	}
	return element.storyBridge;
}

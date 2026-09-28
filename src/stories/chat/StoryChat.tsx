// 実チャットを描画し、ストーリーの検証から通信記録と明示的な応答注入へアクセスする。
import { useMemo } from "react";
import { ChatApp } from "../../webview/chat/ChatApp";
import type { UiMessage } from "../../shared/messages";
import type { StoryBridge } from "./mocks/storyBridge";

/** Storybook の描画要素にだけ検証用の窓口を付ける。 */
export function StoryChat({ bridge }: { bridge: StoryBridge }) {
	const observed = useMemo(() => {
		const sent: UiMessage[] = [];
		return {
			...bridge,
			sent,
			postMessage(message: UiMessage) {
				sent.push(structuredClone(message));
				bridge.postMessage(message);
			},
		};
	}, [bridge]);
	return (
		<div
			style={{ display: "contents" }}
			data-story-chat
			ref={(element) => {
				if (element) {
					Object.assign(element, { storyBridge: observed });
				}
			}}
		>
			<ChatApp bridge={observed} />
		</div>
	);
}

/** 操作後の送信内容を play から検証する。 */
export function storyBridge(canvas: HTMLElement): StoryBridge {
	const element = canvas.querySelector<
		HTMLElement & { storyBridge: StoryBridge }
	>("[data-story-chat]");
	if (!element) {
		throw new Error("StoryChat is not mounted");
	}
	return element.storyBridge;
}

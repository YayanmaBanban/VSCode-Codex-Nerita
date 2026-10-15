// DLC のストーリーへ初期 Host 応答を配信し、以後の応答は各シナリオが指定する。
import type { DlcView } from "@nerita/shared/dlc/contracts";
import type { UiMessage } from "@nerita/shared/messages";
import { createStoryBridge, type StoryBridge } from "../mocks/storyBridge";
import { scenarioState } from "../fixtures/chatState";

/** 初期化要求には一度だけ応答する。保存・実行・復旧の製品ロジックは代替しない。 */
export function createWorkspaceBridge(
	initialView: DlcView,
	expanded: number[],
): StoryBridge {
	const mock = createStoryBridge(scenarioState("empty"));
	let initialized = false;
	return {
		...mock,
		postMessage(message: UiMessage) {
			mock.postMessage(message);
			if (message.type !== "ui/ready" || initialized) {
				return;
			}
			initialized = true;
			mock.emit({
				type: "dlc/editorState",
				state: {
					expanded: Object.fromEntries(
						initialView.intents.map((intent) => [
							intent.intentId,
							expanded,
						]),
					),
				},
			});
			mock.emit({ type: "dlc/state", view: initialView });
		},
	};
}

/** 実コンポーネントに接続した通信窓口をシナリオから取得する。 */
export function workspaceBridge(element: HTMLElement): StoryBridge {
	const host = element.querySelector<HTMLElement & { bridge: StoryBridge }>(
		"[data-story-dlc]",
	);
	if (!host) {
		throw new Error("DLC のストーリーが初期化されていません。");
	}
	return host.bridge;
}

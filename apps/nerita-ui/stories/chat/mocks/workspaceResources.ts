// ワークスペースと会話参照の検索に固定データを返す。
import type { StoryBridge } from "./storyBridge";
import { mockResolvePath, mockWorkspacePaths } from "./mockWorkspacePaths";
import { mockWorkspaceSymbols } from "./mockWorkspaceSymbols";
import { mockSessionReferences } from "./mockSessionReferences";

/** UI の編集確定後に外部データの応答を届ける。 */
export function withWorkspaceResources(bridge: StoryBridge): StoryBridge {
	return {
		...bridge,
		postMessage(message) {
			bridge.postMessage(message);
			if (message.type === "workspace/resolvePath") {
				setTimeout(() => bridge.emit(mockResolvePath(message)), 0);
			} else if (message.type === "workspace/listPaths") {
				queueMicrotask(() => bridge.emit(mockWorkspacePaths(message)));
			} else if (message.type === "workspace/searchSymbols") {
				queueMicrotask(() =>
					bridge.emit(mockWorkspaceSymbols(message)),
				);
			} else if (message.type === "session/searchReferences") {
				queueMicrotask(() =>
					bridge.emit(mockSessionReferences(message)),
				);
			}
		},
	};
}

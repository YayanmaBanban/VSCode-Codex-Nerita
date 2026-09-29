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
			switch (message.type) {
				case "workspace/resolvePath":
					setTimeout(() => bridge.emit(mockResolvePath(message)), 0);
					break;
				case "workspace/listPaths":
					queueMicrotask(() =>
						bridge.emit(mockWorkspacePaths(message)),
					);
					break;
				case "workspace/searchSymbols":
					queueMicrotask(() =>
						bridge.emit(mockWorkspaceSymbols(message)),
					);
					break;
				case "session/searchReferences":
					queueMicrotask(() =>
						bridge.emit(mockSessionReferences(message)),
					);
					break;
			}
		},
	};
}

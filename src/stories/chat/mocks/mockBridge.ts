// 表示状態と外部データの固定応答を組み合わせる。
import type { BackendId } from "../../../shared/backend";
import { createBuiltinUiRegistry } from "../../../extension/ui-contributions/builtinContributions";
import { scenarioState, type Scenario } from "../fixtures/chatState";
import { createStoryBridge } from "./storyBridge";
import { withAttachmentResources } from "./attachmentResources";
import { withWorkspaceResources } from "./workspaceResources";
export type { Scenario } from "../fixtures/chatState";

/** 本番の表示宣言を使い、操作による状態遷移は持たない。 */
export function createChatStoryBridge(
	scenario: Scenario = "empty",
	backend: BackendId = "codex",
) {
	let state = scenarioState(scenario);
	const registry = createBuiltinUiRegistry();
	const contributions = () =>
		registry.resolve(state, {
			backend,
			provider: backend === "codex" ? "openai-codex" : "local",
			capabilities: state.configOptions.map((option) => option.id),
		});
	state.uiContributions = contributions();
	const bridge = withAttachmentResources(
		withWorkspaceResources(createStoryBridge(state)),
	);
	return {
		...bridge,
		patchState(patch: Partial<typeof state>) {
			state = { ...state, ...structuredClone(patch) };
			bridge.patchState({ ...patch, uiContributions: contributions() });
		},
		postMessage(message: Parameters<typeof bridge.postMessage>[0]) {
			bridge.postMessage(message);
			if (message.type === "ui/ready") {
				bridge.emit({ type: "ui/backendState", backend });
			}
		},
	};
}

// VS Code API を呼ぶ唯一のブラウザ境界。Storybook では同じ契約を差し替える。
import type { HostMessage, UiMessage } from "../shared/messages";
import { isHostMessage } from "../shared/hostMessageValidation";
import {
	workflowReplySchema,
	type WorkflowBridge,
	type WorkflowRequest,
} from "../shared/workflows/messages";
import type { PiAuthRequest } from "../shared/piAuth";
import {
	managerReplySchema,
	type ManagerBridge,
	type ManagerRequest,
} from "../shared/agentManager/messages";
import {
	guardReplySchema,
	type GuardBridge,
	type GuardRequest,
} from "../shared/guardrails/messages";
/** UI から利用できる双方向通信の契約。 */
export type Bridge = {
	postMessage: (message: UiMessage) => void;
	subscribe: (listener: (message: HostMessage) => void) => () => void;
};
/** VS Code が Webview に提供する最小 API。 */
type VsCodeApi = {
	postMessage: (
		message:
			| UiMessage
			| PiAuthRequest
			| GuardRequest
			| WorkflowRequest
			| ManagerRequest,
	) => void;
};
declare function acquireVsCodeApi(): VsCodeApi;
let api: VsCodeApi | undefined;
/** Agent Manager の専用通信にも共有スキーマを適用する。 */
export function createAgentManagerBridge(): ManagerBridge {
	api ??= acquireVsCodeApi();
	return {
		postMessage: (message) => api?.postMessage(message),
		subscribe(listener) {
			const receive = (event: MessageEvent<unknown>) => {
				const parsed = managerReplySchema.safeParse(event.data);
				if (parsed.success) {
					listener(parsed.data);
				}
			};
			window.addEventListener("message", receive);
			return () => window.removeEventListener("message", receive);
		},
	};
}
/** Workflow の専用パネルでも受信内容を共有スキーマで検証する。 */
export function createWorkflowBridge(): WorkflowBridge {
	api ??= acquireVsCodeApi();
	return {
		postMessage: (message) => api?.postMessage(message),
		subscribe(listener) {
			const receive = (event: MessageEvent<unknown>) => {
				const parsed = workflowReplySchema.safeParse(event.data);
				if (parsed.success) {
					listener(parsed.data);
				}
			};
			window.addEventListener("message", receive);
			return () => window.removeEventListener("message", receive);
		},
	};
}
/** 設定エディターも同じ API 境界を通し、Host の通知を検証する。 */
export function createGuardrailsBridge(): GuardBridge {
	api ??= acquireVsCodeApi();
	return {
		postMessage: (message) => api?.postMessage(message),
		subscribe(listener) {
			const receive = (event: MessageEvent<unknown>) => {
				const parsed = guardReplySchema.safeParse(event.data);
				if (parsed.success) {
					listener(parsed.data);
				}
			};
			window.addEventListener("message", receive);
			return () => window.removeEventListener("message", receive);
		},
	};
}
/** 認証専用パネルではチャット状態の保存・復元を利用しない。 */
export function createPiAuthPost(): (request: PiAuthRequest) => void {
	api ??= acquireVsCodeApi();
	return (request) => api?.postMessage(request);
}
/** API を一度だけ取得し、購読解除可能な Bridge を返す。 */
export function createVsCodeBridge(): Bridge {
	api ??= acquireVsCodeApi();
	return {
		postMessage: (message) => api?.postMessage(message),
		subscribe(listener) {
			const receive = (event: MessageEvent<unknown>) => {
				if (isHostMessage(event.data)) {
					listener(event.data);
				}
			};
			window.addEventListener("message", receive);
			return () => window.removeEventListener("message", receive);
		},
	};
}

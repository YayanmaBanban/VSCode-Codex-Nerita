// VS Code API を呼ぶ唯一のブラウザ境界。Storybook では同じ契約を差し替える。
import type { UiMessage } from "@nerita/shared/messages";
import type { Bridge } from "@nerita/shared/bridge";
import {
	sandboxReplySchema,
	type SandboxBridge,
	type SandboxRequest,
} from "@nerita/shared/sandboxManagement";
import {
	trustReplySchema,
	type TrustBridge,
	type TrustRequest,
} from "@nerita/shared/workspaceTrust";
import { isHostMessage } from "@nerita/shared/hostMessageValidation";
import {
	workflowReplySchema,
	type WorkflowBridge,
	type WorkflowRequest,
} from "@nerita/shared/workflows/messages";
import type { PiAuthRequest } from "@nerita/shared/piAuth";
import {
	managerReplySchema,
	type ManagerBridge,
	type ManagerRequest,
} from "@nerita/shared/agentManager/messages";
import {
	guardReplySchema,
	type GuardBridge,
	type GuardRequest,
} from "@nerita/shared/guardrails/messages";
/** VS Code が Webview に提供する最小 API。 */
type VsCodeApi = {
	postMessage: (
		message:
			| UiMessage
			| SandboxRequest
			| TrustRequest
			| PiAuthRequest
			| GuardRequest
			| WorkflowRequest
			| ManagerRequest,
	) => void;
};
declare function acquireVsCodeApi(): VsCodeApi;
let api: VsCodeApi | undefined;
/** Sandbox 管理画面でも Host の通知を共有スキーマで検証する。 */
export function createSandboxBridge(): SandboxBridge {
	api ??= acquireVsCodeApi();
	return {
		postMessage: (message) => api?.postMessage(message),
		subscribe(listener) {
			const receive = (event: MessageEvent<unknown>) => {
				const parsed = sandboxReplySchema.safeParse(event.data);
				if (parsed.success) {
					listener(parsed.data);
				}
			};
			window.addEventListener("message", receive);
			return () => window.removeEventListener("message", receive);
		},
	};
}
/** Trust 管理画面の受信データも共有スキーマで検証する。 */
export function createTrustBridge(): TrustBridge {
	api ??= acquireVsCodeApi();
	return {
		postMessage: (message) => api?.postMessage(message),
		subscribe(listener) {
			const receive = (event: MessageEvent<unknown>) => {
				const parsed = trustReplySchema.safeParse(event.data);
				if (parsed.success) {
					listener(parsed.data);
				}
			};
			window.addEventListener("message", receive);
			return () => window.removeEventListener("message", receive);
		},
	};
}
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

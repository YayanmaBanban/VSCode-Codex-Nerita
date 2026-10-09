// VS Code API を呼ぶ唯一のブラウザ境界。Storybook では同じ契約を差し替える。
import type { ZodType } from "zod";
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
	setState: (state: unknown) => void;
	postMessage: (
		message:
			| UiMessage
			| SandboxRequest
			| CredentialRequest
			| TrustRequest
			| PiAuthRequest
			| GuardRequest
			| WorkflowRequest
			| ManagerRequest,
	) => void;
};
declare function acquireVsCodeApi(): VsCodeApi;
import {
	credentialReplySchema,
	type CredentialBridge,
	type CredentialRequest,
} from "@nerita/shared/credentials";
let api: VsCodeApi | undefined;

/** 資格情報管理では秘密値を含まない専用契約で通信する。 */
export function createCredentialBridge(): CredentialBridge {
	return createBridge(schemaReader(credentialReplySchema));
}
/** Sandbox 管理画面でも Host の通知を共有スキーマで検証する。 */
export function createSandboxBridge(): SandboxBridge {
	return createBridge(schemaReader(sandboxReplySchema));
}
/** Trust 管理画面の受信データも共有スキーマで検証する。 */
export function createTrustBridge(): TrustBridge {
	return createBridge(schemaReader(trustReplySchema));
}
/** Agent Manager の専用通信にも共有スキーマを適用する。 */
export function createAgentManagerBridge(): ManagerBridge {
	return createBridge(schemaReader(managerReplySchema));
}
/** Workflow の専用パネルでも受信内容を共有スキーマで検証する。 */
export function createWorkflowBridge(): WorkflowBridge {
	return createBridge(schemaReader(workflowReplySchema));
}
/** 設定エディターも同じ API 境界を通し、Host の通知を検証する。 */
export function createGuardrailsBridge(): GuardBridge {
	return createBridge(schemaReader(guardReplySchema));
}
/** 認証専用パネルではチャット状態の保存・復元を利用しない。 */
export function createPiAuthPost(): (request: PiAuthRequest) => void {
	const acquired = (api ??= acquireVsCodeApi());
	return (request) => acquired.postMessage(request);
}
/** API を一度だけ取得し、購読解除可能な Bridge を返す。 */
export function createVsCodeBridge(): Bridge {
	return createBridge((value) => (isHostMessage(value) ? value : undefined));
}

/** 再読み込み時のパネル復元を有効にする。実際の展開位置は Host の利用者状態に保存する。 */
export function createDlcWorkspaceBridge(): Bridge {
	const bridge = createVsCodeBridge();
	api?.setState({ page: "dlc-workspace" });
	return bridge;
}

/** 型ガードは元参照、Zod は解析済みの値を渡し、購読解除を共通化する。 */
function createBridge<T>(parse: (value: unknown) => T | undefined) {
	const acquired = (api ??= acquireVsCodeApi());
	return {
		postMessage: (message: Parameters<VsCodeApi["postMessage"]>[0]) =>
			acquired.postMessage(message),
		subscribe(listener: (message: T) => void) {
			const receive = (event: MessageEvent<unknown>) => {
				const message = parse(event.data);
				if (message !== undefined) {
					listener(message);
				}
			};
			window.addEventListener("message", receive);
			return () => window.removeEventListener("message", receive);
		},
	};
}

/** 専用パネルはスキーマが返す解析値を通知し、不正な入力を捨てる。 */
function schemaReader<T>(
	schema: ZodType<T>,
): (value: unknown) => T | undefined {
	return (value) => {
		const parsed = schema.safeParse(value);
		return parsed.success ? parsed.data : undefined;
	};
}

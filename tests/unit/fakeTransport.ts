// ACP を起動せず、遅延応答・切断・承認を任意の順序で再現する。
import type {
	PromptResponse,
	RequestPermissionRequest,
	NewSessionResponse,
	AgentCapabilities,
} from "@agentclientprotocol/sdk";
import { vi } from "vitest";
import type {
	AcpCallbacks,
	AcpTransport,
} from "../../src/extension/acp/transport";
import { SessionController } from "../../src/extension/session/sessionController";
import type { AttachmentService } from "../../src/extension/session/sessionOptions";
/** テストから完了・失敗のタイミングを制御する Promise。 */
export function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}
/** 生成された接続を記録するセッション管理のテスト環境。 */
export function fixture(
	options: {
		session?: NewSessionResponse;
		files?: AttachmentService;
		capabilities?: AgentCapabilities;
	} = {},
) {
	const connections: {
		callbacks: AcpCallbacks;
		transport: AcpTransport;
		result: ReturnType<typeof deferred<PromptResponse>>;
	}[] = [];
	const controller = new SessionController((callbacks) => {
		const result = deferred<PromptResponse>();
		const transport: AcpTransport = {
			cwd: process.cwd(),
			listSessions: vi.fn(() => Promise.resolve({ sessions: [] })),
			loadSession: vi.fn(() => Promise.resolve({})),
			forkSession: vi.fn(() => Promise.resolve({ sessionId: "forked" })),
			deleteSession: vi.fn(() => Promise.resolve({})),
			initialize: vi.fn(() =>
				Promise.resolve({
					protocolVersion: 1,
					...(options.capabilities
						? { agentCapabilities: options.capabilities }
						: {}),
					authMethods: [{ id: "chat-gpt", name: "ChatGPT" }],
				}),
			),
			newSession: vi.fn(() =>
				Promise.resolve({
					sessionId: `session-${connections.length}`,
					...options.session,
				}),
			),
			authenticate: vi.fn(() => Promise.resolve({})),
			prompt: vi.fn(() => result.promise),
			readStatus: vi.fn(() => Promise.resolve(null)),
			cancel: vi.fn(() => Promise.resolve()),
			stopAsyncTask: vi.fn(() => Promise.resolve()),
			setConfig: vi.fn(() => Promise.resolve({ configOptions: [] })),
			dispose: vi.fn(async () => {
				result.reject(new Error("closed"));
				await result.promise.catch(() => undefined);
			}),
		};
		connections.push({ callbacks, transport, result });
		return transport;
	}, options.files);
	return { controller, connections };
}
/** 承認・拒否が選べる ACP 要求を作る。 */
export function permissionRequest(sessionId: string): RequestPermissionRequest {
	return {
		sessionId,
		toolCall: { toolCallId: "tool", title: "変更を適用" },
		options: [
			{ optionId: "allow", name: "許可", kind: "allow_once" },
			{ optionId: "reject", name: "拒否", kind: "reject_once" },
		],
	};
}

// 接続・認証の順序は実機の制御を使い、外部サーバーの応答だけを置き換える。
import { CodexLifecycle } from "../../../extension/backends/codex/CodexLifecycle";
import type {
	CodexConnection,
	CodexFactory,
} from "../../../extension/backends/codex/runtime/connection";
import type { Bridge } from "../../../webview/vscodeBridge";
import type { UiMessage } from "../../../shared/messages";
import { createMockBridge } from "./mockBridge";

/** 実機の認証・接続を呼び出すための、プレビュー用の操作窓口。 */
class PreviewLifecycle extends CodexLifecycle {
	protected notification(): void {}
	protected request(): Promise<unknown> {
		return Promise.resolve({ decision: "cancel" });
	}
	protected resetRun(): void {}
	/** 本体の状態遷移を操作メッセージから実行する。 */
	async receive(message: UiMessage): Promise<void> {
		if (message.type === "connection/retry") {
			await this.connect();
		}
		if (message.type === "auth/start") {
			await this.authenticate(message.methodId);
		}
		if (message.type === "auth/logout") {
			await this.logout();
		}
		if (message.type === "session/new") {
			await this.newThread();
		}
	}
}

/** 対象外の操作を成功扱いにせず、ストーリーの不足を検出する。 */
function unsupported(): Promise<never> {
	return Promise.reject(new Error("Unsupported preview operation"));
}

/** 認証結果と初回接続失敗だけを固定し、画面状態を直接作らない。 */
function previewFactory(
	mode: "reconnect" | "success" | "failure",
): CodexFactory {
	let attempts = 0;
	let authenticated = mode === "reconnect";
	return async (callbacks, signal) => {
		await new Promise((resolve) => setTimeout(resolve, 400));
		signal.throwIfAborted();
		if (mode === "reconnect" && attempts++ === 0) {
			throw new Error("Preview disconnected");
		}
		const client: CodexConnection = {
			readAccount: () =>
				Promise.resolve({
					authenticated,
					requiresOpenaiAuth: true,
				}),
			login: async (params) => {
				await new Promise((resolve) => setTimeout(resolve, 400));
				signal.throwIfAborted();
				if (params.type === "apiKey") {
					if (mode === "failure") {
						throw new Error("Preview login failed");
					}
					authenticated = true;
					return { type: "apiKey" };
				}
				authenticated = mode !== "failure";
				callbacks.notification?.({
					method: "account/login/completed",
					params: {
						loginId: "preview-login",
						success: authenticated,
					},
				});
				return {
					type: "chatgpt",
					loginId: "preview-login",
					authUrl: "https://auth.openai.com/authorize",
				};
			},
			cancelLogin: () => Promise.resolve({ status: "cancelled" }),
			logout: () => {
				authenticated = false;
				return Promise.resolve({});
			},
			startThread: () =>
				Promise.resolve({
					thread: { id: "preview-thread" },
					model: "preview-model",
					cwd: ".",
				}),
			dispose: async () => {},
			startTurn: unsupported,
			updateCollaborationMode: unsupported,
			steerTurn: unsupported,
			interruptTurn: unsupported,
			listModels: unsupported,
			listMcpServerStatus: unsupported,
			readRateLimits: unsupported,
			listThreads: unsupported,
			readThread: unsupported,
			resumeThread: unsupported,
			forkThread: unsupported,
			listTurns: unsupported,
			listItems: unsupported,
			renameThread: unsupported,
			archiveThread: unsupported,
			deleteThread: unsupported,
			unarchiveThread: unsupported,
		};
		return { client, cwd: "." };
	};
}

/** 購読の寿命に実接続制御を合わせ、その他の UI 操作だけ既存モックへ渡す。 */
export function createCodexLifecycleBridge(
	mode: "reconnect" | "success" | "failure",
): Bridge {
	const mock = createMockBridge("connecting");
	let session: PreviewLifecycle | undefined;
	let subscribers = 0;
	return {
		subscribe(listener) {
			const unsubscribe = mock.subscribe(listener);
			if (subscribers++ === 0) {
				session = new PreviewLifecycle(previewFactory(mode), {
					open: async () => {},
					apiKey: () => "preview-key",
				});
				const current = session;
				current.subscribe(() => {
					const { revision: _revision, ...state } =
						current.snapshot();
					mock.patchState(state);
				});
				void current.connect();
			}
			return () => {
				unsubscribe();
				if (--subscribers === 0) {
					void session?.dispose();
					session = undefined;
				}
			};
		},
		postMessage(message) {
			if (
				[
					"connection/retry",
					"auth/start",
					"auth/logout",
					"session/new",
				].includes(message.type)
			) {
				void session?.receive(message).catch(() => {
					if ("requestId" in message) {
						mock.emit({
							type: "request/failed",
							requestId: message.requestId,
							error: "プレビューで操作を完了できませんでした。",
						});
					}
				});
				return;
			}
			mock.postMessage(message);
		},
	};
}

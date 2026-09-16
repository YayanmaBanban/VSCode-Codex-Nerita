// App Server の応答順序と通知を任意に制御する、状態管理テスト用の接続。
import type { ModelInfo } from "../../src/extension/codex/accountProtocol";
import { vi } from "vitest";
import type { TurnStartParams } from "../../src/codex-app-server/v2/TurnStartParams";
import type { ThreadStartParams } from "../../src/codex-app-server/v2/ThreadStartParams";
import type { AppServerCallbacks } from "../../src/extension/codex/AppServerTransport";
import { CodexSessionController } from "../../src/extension/codex/CodexSessionController";
import type { CodexConnection } from "../../src/extension/codex/CodexLifecycle";
import type { HistoryThread } from "../../src/extension/codex/historyProtocol";

/** 各テストで保存形式や本文を上書きできる履歴を用意する。 */
export function historyThread(id = "saved"): HistoryThread {
	return {
		id,
		cwd: "D:/workspace",
		name: "保存した会話",
		preview: "hello",
		updatedAt: 1700000000,
		active: false,
		historyMode: "legacy",
		turns: [],
	};
}

/** テスト側から応答の到着時刻を制御する。 */
export function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
/** 接続ごとに独立した client と通知先を記録する。 */
export function codexHarness() {
	let thread = 0;
	let turn = 0;
	const models: ModelInfo[] = [];
	const client = {
		listThreads: vi.fn<CodexConnection["listThreads"]>(() =>
			Promise.resolve({ data: [], nextCursor: null }),
		),
		readThread: vi.fn<CodexConnection["readThread"]>((id) =>
			Promise.resolve({ thread: historyThread(id) }),
		),
		resumeThread: vi.fn<CodexConnection["resumeThread"]>((id) =>
			Promise.resolve({
				thread: historyThread(id),
				model: "test-model",
				cwd: "D:/workspace",
			}),
		),
		forkThread: vi.fn<CodexConnection["forkThread"]>(() =>
			Promise.resolve({
				thread: historyThread("forked"),
				model: "test-model",
				cwd: "D:/workspace",
			}),
		),
		listTurns: vi.fn<CodexConnection["listTurns"]>(() =>
			Promise.resolve({ data: [], nextCursor: null }),
		),
		listItems: vi.fn<CodexConnection["listItems"]>(() =>
			Promise.resolve({ data: [], nextCursor: null }),
		),
		renameThread: vi.fn<CodexConnection["renameThread"]>(() =>
			Promise.resolve({}),
		),
		deleteThread: vi.fn<CodexConnection["deleteThread"]>(() =>
			Promise.resolve({}),
		),
		archiveThread: vi.fn<CodexConnection["archiveThread"]>(() =>
			Promise.resolve({}),
		),
		unarchiveThread: vi.fn<CodexConnection["unarchiveThread"]>((id) =>
			Promise.resolve({ thread: historyThread(id) }),
		),
		listModels: vi.fn(() =>
			Promise.resolve({
				data: models,
				nextCursor: null as string | null,
			}),
		),
		readRateLimits: vi.fn(() => Promise.resolve([])),
		login: vi.fn(() => Promise.resolve({ type: "apiKey" as const })),
		cancelLogin: vi.fn(() => Promise.resolve({ status: "cancelled" })),
		startThread: vi.fn((_params: ThreadStartParams) =>
			Promise.resolve({
				thread: { id: `thread-${++thread}` },
				model: "test-model",
				cwd: "D:/workspace",
			}),
		),
		startTurn: vi.fn((params: TurnStartParams) => {
			const id = `turn-${++turn}`;
			connections.at(-1)?.callbacks.notification?.({
				method: "turn/started",
				params: {
					threadId: params.threadId,
					turn: { id, status: "inProgress", items: [] },
				},
			});
			return Promise.resolve({
				turn: { id, status: "inProgress" as const },
			});
		}),
		interruptTurn: vi.fn((_thread: string, _turn: string) =>
			Promise.resolve({}),
		),
		steerTurn: vi.fn<CodexConnection["steerTurn"]>((params) =>
			Promise.resolve({ turnId: params.expectedTurnId }),
		),
		readAccount: vi.fn(() =>
			Promise.resolve({ authenticated: true, requiresOpenaiAuth: true }),
		),
		dispose: vi.fn(() => Promise.resolve()),
	};
	const connections: {
		callbacks: AppServerCallbacks;
		signal: AbortSignal;
	}[] = [];
	const factory = vi.fn(
		(callbacks: AppServerCallbacks, signal: AbortSignal) => {
			connections.push({ callbacks, signal });
			return Promise.resolve({ client, cwd: "D:/workspace" });
		},
	);
	const session = new CodexSessionController(factory);
	/** 現在の接続から通知を送る。 */
	const notify = (method: string, params: unknown) =>
		connections.at(-1)!.callbacks.notification?.({ method, params });
	/** 現在の会話へ一度だけ送る。 */
	const send = (text = "hello") =>
		session.receive({
			type: "prompt/send",
			requestId: crypto.randomUUID(),
			sessionId: session.snapshot().sessionId,
			text,
		});
	/** 表示中の実行を停止する。 */
	const cancel = () =>
		session.receive({
			type: "prompt/cancel",
			requestId: crypto.randomUUID(),
			sessionId: session.snapshot().sessionId,
			runId: session.snapshot().runId,
		});
	/** 指定ターンの完了通知を送る。 */
	const complete = (id = `turn-${turn}`, status = "completed") =>
		notify("turn/completed", {
			threadId: session.snapshot().sessionId,
			turn: { id, status, items: [] },
		});
	return {
		session,
		client,
		factory,
		connections,
		notify,
		send,
		cancel,
		complete,
	};
}

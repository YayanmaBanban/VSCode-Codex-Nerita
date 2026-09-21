// Pi SDK境界だけを差し替え、Controllerの受付・通知・停止を独立して検証する。
import { vi } from "vitest";
import { PiSessionController } from "../../src/extension/backends/pi/PiSessionController";
import type {
	PiEvent,
	PiSession,
	PiFactory,
} from "../../src/extension/backends/pi/PiRuntime";
import type { HostMessage } from "../../src/shared/messages";

/** 任意のタイミングで終了するSDK送信を作る。 */
export function pending<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

/** SDKイベントの最小Assistant応答を作る。 */
export function assistant(
	text: string,
	stopReason: "stop" | "error" | "aborted" = "stop",
) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		api: "openai-completions" as const,
		provider: "local",
		model: "test",
		stopReason,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		timestamp: 1,
	};
}

/** 受付前と実行中の停止を制御できるテスト用SDKを作る。 */
export function piHarness() {
	const listeners = new Set<(event: PiEvent) => void>();
	let run = pending<void>();
	let sequence = 0;
	const events: HostMessage[] = [];
	const runtime: PiSession = {
		sessionId: "pi-1",
		model: undefined,
		isStreaming: true,
		steer: vi.fn<PiSession["steer"]>().mockResolvedValue(undefined),
		clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		prompt: vi.fn<PiSession["prompt"]>((_text, options) => {
			run = pending<void>();
			options?.preflightResult?.(true);
			return run.promise;
		}),
		abort: vi.fn(() => {
			run.resolve();
			return Promise.resolve();
		}),
		dispose: vi.fn(),
	};
	const factory = vi.fn<PiFactory>(() =>
		Promise.resolve({ session: runtime, cwd: "D:\\workspace" }),
	);
	const controller = new PiSessionController(factory);
	controller.subscribe((event) => events.push(event));
	return {
		controller,
		runtime,
		factory,
		events,
		emit: (event: PiEvent) => {
			for (const listener of listeners) {
				listener(event);
			}
		},
		complete: () => run.resolve(),
		send: (text = "hello", requestId = `send-${++sequence}`) =>
			controller.receive({
				type: "prompt/send",
				requestId,
				sessionId: "pi-1",
				text,
			}),
		stop: () =>
			controller.receive({
				type: "prompt/cancel",
				requestId: `stop-${++sequence}`,
				sessionId: "pi-1",
				runId: controller.snapshot().runId,
			}),
	};
}

// 既存 BackendSession の実行通知を待ち、承認を現在の独立セッションへ返す。
import { randomUUID } from "node:crypto";
import type {
	ChatState,
	Permission,
	PermissionOption,
} from "@nerita/shared/chatState";
import type { HostMessage } from "@nerita/shared/messages";
import type { BackendSession } from "../session/chatSession";

export type ApprovalPrompt = (
	permission: Permission,
	signal: AbortSignal,
) => Promise<PermissionOption | undefined>;

/** 資格情報が未設定なら待ち続けず、既存の認証画面での設定を求める。 */
export async function connectSession(
	session: BackendSession,
	signal: AbortSignal,
): Promise<void> {
	const connected = waitForState(
		session,
		(state) =>
			["ready", "error", "auth-required"].includes(state.connection),
		signal,
	);
	const [state] = await Promise.all([
		connected,
		session.receive({ type: "connection/retry", requestId: randomUUID() }),
	]);
	if (state.connection !== "ready" || state.sessionId === null) {
		throw new Error(
			state.error ??
				"Nerita の認証・モデル・Sandbox 設定を完了してください。",
		);
	}
}

/** メッセージの送信受付と実行の完了を区別し、途中のツール応答では完了しない。 */
export async function executeSession(
	session: BackendSession,
	prompt: string,
	signal: AbortSignal,
): Promise<ChatState> {
	const requestId = randomUUID();
	const terminal = waitForState(
		session,
		(state) => ["completed", "cancelled", "failed"].includes(state.run),
		signal,
		requestId,
	);
	const [state] = await Promise.all([
		terminal,
		session.receive({
			type: "prompt/send",
			requestId,
			sessionId: session.snapshot().sessionId,
			text: prompt,
		}),
	]);
	return state;
}

/** 停止時には SDK の終了も待つ。セッション ID はこの実行境界内だけで使う。 */
export async function stopSession(session: BackendSession): Promise<void> {
	const state = session.snapshot();
	if (state.sessionId !== null && state.runId !== null) {
		await session.receive({
			type: "prompt/cancel",
			requestId: randomUUID(),
			sessionId: state.sessionId,
			runId: state.runId,
		});
	}
	session.invalidate();
}

/** 承認の省略を許可へ変換しない。拒否と停止はバックエンドの選択肢をそのまま使う。 */
export async function answerPermission(
	session: BackendSession,
	permission: Permission,
	prompt: ApprovalPrompt,
	signal: AbortSignal,
): Promise<PermissionOption> {
	const chosen = await prompt(permission, signal);
	signal.throwIfAborted();
	const option =
		permission.options.find((item) => item.id === chosen?.id) ??
		permission.options.find(
			(item) => item.kind === "abort" || item.kind === "deny",
		);
	if (!option) {
		throw new Error("承認に回答できません。実行を停止してください。");
	}
	const state = session.snapshot();
	await session.receive({
		type: "permission/respond",
		requestId: randomUUID(),
		sessionId: state.sessionId,
		runId: state.runId,
		permissionId: permission.id,
		optionId: option.id,
	});
	return option;
}

function waitForState(
	session: BackendSession,
	predicate: (state: ChatState) => boolean,
	signal: AbortSignal,
	requestId?: string,
): Promise<ChatState> {
	return new Promise((resolve, reject) => {
		let unsubscribe = () => {};
		const cleanup = () => {
			unsubscribe();
			signal.removeEventListener("abort", aborted);
		};
		const aborted = () => {
			cleanup();
			reject(new Error("DLC の実行を停止しました。"));
		};
		const receive = (event?: HostMessage) => {
			if (
				event?.type === "request/failed" &&
				(requestId === undefined || event.requestId === requestId)
			) {
				cleanup();
				reject(new Error(event.error));
				return;
			}
			const state = session.snapshot();
			if (
				requestId !== undefined &&
				["error", "disconnected"].includes(state.connection)
			) {
				cleanup();
				reject(
					new Error(state.error ?? "実行中の接続が終了しました。"),
				);
				return;
			}
			if (predicate(state)) {
				cleanup();
				resolve(state);
			}
		};
		unsubscribe = session.subscribe(receive);
		signal.addEventListener("abort", aborted, { once: true });
		if (signal.aborted) {
			aborted();
		} else {
			receive();
		}
	});
}

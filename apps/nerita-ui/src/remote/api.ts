// 同一 Origin の Remote API と SSE を検証済みの状態に変換する。
import {
	remoteFilesReplySchema,
	type RemoteFilesRequest,
} from "@nerita/shared/remote/files";
import {
	remoteBootstrapSchema,
	remoteErrorSchema,
	remoteStateSchema,
	type RemoteAction,
	type RemoteChatState,
} from "@nerita/shared/remote/contracts";

/** 画面が利用するリモート通信とイベント購読の境界。 */
export type RemoteTransport = {
	bootstrap: typeof bootstrap;
	pair: typeof pair;
	sendAction: typeof sendAction;
	workspace?: typeof workspace;
	logout: typeof logout;
	connectEvents: (
		state: (snapshot: RemoteChatState) => void,
		interrupted: () => void,
	) => Pick<EventSource, "close" | "readyState">;
};

export const browserRemoteTransport: RemoteTransport = {
	bootstrap,
	pair,
	sendAction,
	workspace,
	logout,
	connectEvents,
};

/** HTTP ステータス付きの公開エラーを画面側へ伝える。 */
export class RemoteResponseError extends Error {
	/** HTTP エラーとネットワーク障害を区別できるようにする。 */
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/** 同一 Origin へ JSON のみ送り、公開エラー契約を検証する。 */
async function request(
	path: string,
	body?: object,
	csrf?: string,
): Promise<unknown> {
	const headers = new Headers();
	if (body !== undefined) {
		headers.set("Content-Type", "application/json");
	}
	if (csrf !== undefined) {
		headers.set("X-Nerita-CSRF", csrf);
	}
	const response = await fetch(`/api/v1/${path}`, {
		method: body === undefined ? "GET" : "POST",
		body: body === undefined ? null : JSON.stringify(body),
		headers,
		cache: "no-store",
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) {
		const payload: unknown = await response.json().catch(() => undefined);
		const result = remoteErrorSchema.safeParse(payload);
		throw new RemoteResponseError(
			response.status,
			result.success
				? result.data.error.message
				: "PCのNeritaとTailscaleの接続を確認してください。",
		);
	}
	return response.json();
}

/** 認証済みの初期状態と CSRF トークンを検証する。 */
export async function bootstrap() {
	return remoteBootstrapSchema.parse(await request("bootstrap"));
}

/** 短寿命のペアリングコードを Cookie と交換する。 */
export async function pair(code: string) {
	await request("pair", { code });
}

/** 現在の CSRF を添え、明示された操作を一度送信する。 */
export async function sendAction(action: RemoteAction, csrf: string) {
	await request("actions", action, csrf);
}

/** 変更ファイルと Git 操作は専用の公開契約を検証する。 */
export async function workspace(operation: RemoteFilesRequest, csrf: string) {
	return remoteFilesReplySchema.parse(
		await request("workspace", operation, csrf),
	);
}

/** 現在のブラウザーセッションを失効させる。 */
export async function logout(csrf: string) {
	await request("logout", {}, csrf);
}

/** 受信した全量状態を検証し、形式違反は接続を更新する。 */
export function connectEvents(
	state: (snapshot: RemoteChatState) => void,
	interrupted: () => void,
): EventSource {
	const source = new EventSource("/api/v1/events");
	source.addEventListener("state", (event: MessageEvent<string>) => {
		try {
			const payload: unknown = JSON.parse(event.data);
			state(remoteStateSchema.parse(payload));
		} catch {
			source.close();
			interrupted();
		}
	});
	source.onerror = interrupted;
	return source;
}

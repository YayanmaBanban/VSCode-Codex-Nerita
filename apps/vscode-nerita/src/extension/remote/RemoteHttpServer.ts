// ループバック限定でモバイル資産と認証済み API を配信する。
import { remoteFilesRequestSchema } from "@nerita/shared/remote/files";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { join } from "node:path";
import {
	remoteActionSchema,
	remoteBodyBytes,
	remotePairSchema,
} from "@nerita/shared/remote/contracts";
import type { RemoteChatAdapter } from "./RemoteChatAdapter";
import { RemoteAuth } from "./RemoteAuth";
import { RemoteError } from "./RemoteError";
import { RemoteEvents } from "./RemoteEvents";

export const defaultRemotePort = 43927;

const assetFiles = [
	["/", "index.html", "text/html; charset=utf-8"],
	["/index.js", "index.js", "text/javascript; charset=utf-8"],
	["/index.css", "index.css", "text/css; charset=utf-8"],
] as const;
const apiMethods = new Map([
	["/api/v1/pair", "POST"],
	["/api/v1/bootstrap", "GET"],
	["/api/v1/events", "GET"],
	["/api/v1/actions", "POST"],
	["/api/v1/workspace", "POST"],
	["/api/v1/logout", "POST"],
]);

/** Serve の URL に使う DNS 名だけを受け付ける。 */
export function remoteHostname(value: string): boolean {
	return (
		value.length <= 253 &&
		/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}ts\.net$/u.test(value)
	);
}

/** 固定の JSON 形式で応答を終了する。 */
function json(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
	});
	response.end(JSON.stringify(body));
}

/** 静的 UI と API の両方にブラウザーの制限を適用する。 */
function headers(response: ServerResponse): void {
	response.setHeader("Cache-Control", "no-store");
	response.setHeader(
		"Content-Security-Policy",
		"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
	);
	response.setHeader("X-Content-Type-Options", "nosniff");
	response.setHeader("Referrer-Policy", "no-referrer");
}

/** チャンク転送でも上限を適用してから UTF-8 を復号する。 */
async function readJson(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let length = 0;
	for await (const chunk of request.iterator({ destroyOnReturn: false })) {
		if (!Buffer.isBuffer(chunk)) {
			throw new RemoteError("invalid_request");
		}
		length += chunk.length;
		if (length > remoteBodyBytes) {
			throw new RemoteError("payload_too_large");
		}
		chunks.push(chunk);
	}
	try {
		return JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(
				Buffer.concat(chunks, length),
			),
		);
	} catch {
		throw new RemoteError("invalid_request");
	}
}

/** 起動時に読み込む固定パスの配布資産。 */
type Assets = Map<string, { body: Buffer; contentType: string }>;

/** Host と Origin を固定して、ブラウザー用の API だけを受け付ける。 */
export class RemoteHttpServer {
	private readonly connectionGeneration = randomUUID();
	private readonly events: RemoteEvents;
	private readonly auth: RemoteAuth;
	private readonly origin: string;
	private readonly server = createServer({
		maxHeaderSize: 8192,
		headersTimeout: 10_000,
		requestTimeout: 10_000,
		connectionsCheckingInterval: 1000,
	});
	private assets: Assets = new Map();
	private closed = false;
	private rate = { until: 0, count: 0 };

	/** 認証済みブラウザーの接続状態を返す。 */
	connected(): boolean {
		return this.events.connected();
	}

	/** 閉じたダイアログの未使用コードを無効にする。 */
	cancelPairing(): void {
		this.auth.cancelPairing();
	}

	/** 認証・SSE と HTTP の寿命を結び付ける。 */
	constructor(
		private readonly hostname: string,
		private readonly chat: RemoteChatAdapter,
		private readonly notifications: {
			onPaired?: () => void;
			onConnectionChange?: () => void;
		} = {},
	) {
		if (!remoteHostname(hostname)) {
			throw new RemoteError("invalid_request");
		}
		this.origin = `https://${hostname}`;
		this.events = new RemoteEvents(
			() => this.chat.snapshot(this.connectionGeneration),
			(notify) => this.chat.subscribe(notify),
			this.notifications.onConnectionChange,
		);
		this.auth = new RemoteAuth(() => this.events.disconnect());
		this.server.maxConnections = 32;
		this.server.on("request", (request, response) => {
			headers(response);
			response.on("error", () => response.destroy());
			void this.route(request, response).catch((error: unknown) =>
				this.failRequest(request, response, error),
			);
		});
		this.server.on("error", () => this.stop());
	}

	/** 静的資産がそろうまで TCP ポートを開かない。 */
	async start(directory: string, port: number): Promise<void> {
		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			throw new RemoteError("invalid_request");
		}
		for (const [route, filename, contentType] of assetFiles) {
			const body = await readFile(join(directory, filename));
			if (body.length === 0) {
				throw new RemoteError("host_unavailable");
			}
			this.assets.set(route, { body, contentType });
		}
		if (this.closed) {
			throw new RemoteError("host_unavailable");
		}
		await this.listen(port);
	}

	/** 停止・競合・待受成功のいずれでも初期化を完了させる。 */
	private async listen(port: number): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			/** 起動結果が確定したら一時的な購読を解除する。 */
			const finish = (error?: Error) => {
				this.server.off("error", finish);
				this.server.off("close", cancelled);
				this.server.off("listening", finish);
				if (error === undefined) {
					resolve();
				} else {
					reject(error);
				}
			};
			/** 待受の成立前に停止された場合の結果。 */
			const cancelled = () => finish(new RemoteError("host_unavailable"));
			this.server.once("error", finish);
			this.server.once("close", cancelled);
			this.server.once("listening", finish);
			this.server.listen(port, "127.0.0.1");
		});
	}

	/** 待受中だけ PC に表示する一回限りのコードを発行する。 */
	issueCode(): string {
		if (!this.server.listening || this.closed) {
			throw new RemoteError("host_unavailable");
		}
		return this.auth.issueCode();
	}

	/** 現在の端末と保留中のコードを失効させる。 */
	revoke(): void {
		this.auth.revoke();
	}

	/** 待受と既存の HTTP 接続をまとめて閉じる。 */
	stop(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.revoke();
		this.server.close();
		this.server.closeAllConnections();
	}

	/** 予期しない内部エラーの本文を端末へ送らず、未読の本文があれば接続を終了する。 */
	private failRequest(
		request: IncomingMessage,
		response: ServerResponse,
		error: unknown,
	): void {
		if (response.destroyed) {
			return;
		}
		if (response.headersSent) {
			response.destroy();
			return;
		}
		if (!request.complete) {
			response.setHeader("Connection", "close");
		}
		const failure =
			error instanceof RemoteError
				? error
				: new RemoteError("host_unavailable");
		json(response, failure.status, {
			ok: false,
			error: { code: failure.code, message: failure.message },
		});
	}

	/** Serve が転送した公開 Host・HTTPS を照合し、Funnel を拒否する。 */
	private checkHost(supplied: IncomingMessage["headers"]): void {
		const matchesHost =
			supplied.host === this.hostname &&
			supplied["x-forwarded-host"] === this.hostname;
		const secure = supplied["x-forwarded-proto"] === "https";
		const funnel = supplied["tailscale-funnel-request"] !== undefined;
		if (!matchesHost || !secure || funnel) {
			throw new RemoteError("forbidden");
		}
	}

	/** URL を正規化せず、配布資産と固定 API のパスだけを受け付ける。 */
	private async route(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		this.checkOpen();
		this.checkHost(request.headers);
		this.limitRequests();
		const path = request.url ?? "";
		const asset = this.assets.get(path);
		const method = asset ? "GET" : apiMethods.get(path);
		if (method === undefined) {
			json(response, 404, { ok: false });
			return;
		}
		if (request.method !== method) {
			response.setHeader("Allow", method);
			json(response, 405, { ok: false });
			return;
		}
		if (asset) {
			response.writeHead(200, { "Content-Type": asset.contentType });
			response.end(asset.body);
			return;
		}
		if (method === "POST") {
			this.checkPost(request);
		}
		await this.api(path, request, response);
	}

	/** ペアリングだけは Cookie を要求せず、その他は認証してから状態の読取りか書込みへ進む。 */
	private async api(
		path: string,
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		if (path === "/api/v1/pair") {
			await this.pair(request, response);
			return;
		}
		const session = this.auth.authenticate(request.headers.cookie);
		if (path === "/api/v1/bootstrap") {
			json(response, 200, {
				csrf: session.csrf,
				state: this.chat.snapshot(this.connectionGeneration),
			});
			return;
		}
		if (path === "/api/v1/events") {
			if (!this.events.connect(response)) {
				throw new RemoteError("too_many_requests");
			}
			return;
		}
		this.auth.verifyCsrf(session, request.headers["x-nerita-csrf"]);
		const body = await readJson(request);
		if (!this.auth.active(session)) {
			throw new RemoteError("unauthenticated");
		}
		if (path === "/api/v1/logout") {
			this.logout(body, response);
			return;
		}
		if (path === "/api/v1/workspace") {
			const operation = remoteFilesRequestSchema.safeParse(body);
			if (!operation.success) {
				throw new RemoteError("invalid_request");
			}
			this.auth.claim(session, operation.data.requestId);
			const result = await this.chat.workspace(operation.data, () =>
				this.auth.active(session),
			);
			json(response, 200, result);
			return;
		}
		const action = remoteActionSchema.safeParse(body);
		if (!action.success) {
			throw new RemoteError("invalid_request");
		}
		this.auth.claim(session, action.data.requestId);
		await this.chat.apply(action.data, () => this.auth.active(session));
		json(response, 200, { ok: true, requestId: action.data.requestId });
	}

	/** 受信したコードを認証し、トークンを HttpOnly Cookie にだけ設定する。 */
	private async pair(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		const pair = remotePairSchema.safeParse(await readJson(request));
		if (!pair.success) {
			throw new RemoteError("invalid_request");
		}
		this.checkOpen();
		response.setHeader("Set-Cookie", this.auth.pair(pair.data.code));
		json(response, 200, { ok: true });
		this.notifications.onPaired?.();
	}

	/** 本文の受信中に停止されたサーバーへの操作を拒否する。 */
	private checkOpen(): void {
		if (this.closed) {
			throw new RemoteError("host_unavailable");
		}
	}

	/** 現在の端末を失効し、ブラウザーに Cookie の削除を指示する。 */
	private logout(body: unknown, response: ServerResponse): void {
		const object =
			typeof body === "object" && body !== null && !Array.isArray(body);
		if (!object || Object.keys(body).length > 0) {
			throw new RemoteError("invalid_request");
		}
		this.revoke();
		response.setHeader("Set-Cookie", this.auth.clearCookie());
		json(response, 200, { ok: true });
	}

	/** 本文を受け取る前に Origin とサイズ・形式を確認する。 */
	private checkPost(request: IncomingMessage): void {
		const { headers: supplied } = request;
		if (supplied.origin !== this.origin) {
			throw new RemoteError("csrf_invalid");
		}
		if (Number(supplied["content-length"]) > remoteBodyBytes) {
			throw new RemoteError("payload_too_large");
		}
		const jsonContentType =
			/^application\/json(?:\s*;\s*charset=utf-8)?$/iu;
		if (!jsonContentType.test(supplied["content-type"] ?? "")) {
			throw new RemoteError("invalid_request");
		}
	}

	/** プロキシで送信元が集約されるため、全体の要求数を制限する。 */
	private limitRequests(): void {
		const now = Date.now();
		if (now >= this.rate.until) {
			this.rate = { until: now + 1000, count: 0 };
		}
		this.rate.count++;
		if (this.rate.count > 32) {
			throw new RemoteError("too_many_requests");
		}
	}
}

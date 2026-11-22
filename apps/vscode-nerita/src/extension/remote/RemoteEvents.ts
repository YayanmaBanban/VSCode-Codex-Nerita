// 認証済み SSE 接続を管理し、全量状態の配信頻度を制限する。
import type { ServerResponse } from "node:http";
import type { RemoteChatState } from "@nerita/shared/remote/contracts";

const bufferLimit = 1024 * 1024;
const interval = 250;

/** 公開状態の購読と SSE ソケットを同じ寿命で管理する。 */
export class RemoteEvents {
	private readonly clients = new Set<ServerResponse>();
	private pending: ReturnType<typeof setTimeout> | undefined;
	private heartbeat: ReturnType<typeof setInterval> | undefined;
	private unsubscribe: (() => void) | undefined;
	private sentAt = 0;

	/** 全量状態の取得と更新通知を既存のチャットに委ねる。 */
	constructor(
		private readonly snapshot: () => RemoteChatState,
		private readonly subscribe: (
			notify: (urgent: boolean) => void,
		) => () => void,
		private readonly onConnectionChange?: () => void,
	) {}

	/** 最新状態と後続購読を一続きの同期処理で確立する。 */
	connect(response: ServerResponse): boolean {
		if (this.clients.size >= 4) {
			return false;
		}
		const initial = this.state();
		response.writeHead(200, {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-store, no-transform",
		});
		this.clients.add(response);
		if (this.clients.size === 1) {
			this.onConnectionChange?.();
		}
		response.on("close", () => this.remove(response));
		this.unsubscribe ??= this.subscribe((urgent) => this.schedule(urgent));
		this.heartbeat ??= setInterval(
			() => this.broadcast(": heartbeat\n\n"),
			15_000,
		);
		this.write(response, `retry: 2000\n${initial}`);
		return true;
	}

	/** 認証を失った端末の配信を即座に終了する。 */
	disconnect(): void {
		const wasConnected = this.connected();
		for (const response of this.clients) {
			response.destroy();
		}
		this.clients.clear();
		this.clear();
		if (wasConnected) {
			this.onConnectionChange?.();
		}
	}

	/** 認証済みブラウザーが現在受信中かを返す。 */
	connected(): boolean {
		return this.clients.size > 0;
	}

	/** 最後のブラウザーが閉じた時点で PC の表示を更新する。 */
	private remove(response: ServerResponse): void {
		if (this.clients.delete(response) && this.clients.size === 0) {
			this.clear();
			this.onConnectionChange?.();
		}
	}

	/** 通常更新をまとめ、重要な状態は待たずに送る。 */
	private schedule(urgent: boolean): void {
		const delay = interval - (Date.now() - this.sentAt);
		if (urgent || delay <= 0) {
			this.publish();
		} else {
			this.pending ??= setTimeout(() => this.publish(), delay);
		}
	}

	/** 保留タイマーを消し、最新状態だけを送る。 */
	private publish(): void {
		clearTimeout(this.pending);
		this.pending = undefined;
		this.sentAt = Date.now();
		this.broadcast(this.state());
	}

	/** JSON の改行をエスケープして単一の SSE イベントにする。 */
	private state(): string {
		return `event: state\ndata: ${JSON.stringify(this.snapshot())}\n\n`;
	}

	/** 公開フレームを現在接続中のクライアントへ送る。 */
	private broadcast(frame: string): void {
		for (const response of this.clients) {
			this.write(response, frame);
		}
	}

	/** 滞留中のバイト数を制限し、遅い接続を切る。 */
	private write(response: ServerResponse, frame: string): void {
		if (response.writableLength + Buffer.byteLength(frame) > bufferLimit) {
			response.destroy();
			return;
		}
		response.write(frame);
	}

	/** 最後のクライアントが退出したら購読とタイマーを解除する。 */
	private clear(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		clearTimeout(this.pending);
		this.pending = undefined;
		clearInterval(this.heartbeat);
		this.heartbeat = undefined;
	}
}

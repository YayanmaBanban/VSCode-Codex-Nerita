// 標準出力を一チャンクずつ Worker に移譲し、受信順と切断時の待機解放を保証する。
import type { Readable } from "node:stream";
import { Worker } from "node:worker_threads";
import { isRecord } from "@nerita/shared/validation";
import { runAppServerJsonWorker } from "./AppServerJsonWorker";

/** Worker が一チャンク分を解析し終えるまで、次の送信を保留する。 */
type Pending = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
};

/** 接続ごとに Worker を再利用し、ストリームの背圧で解析待ちの増殖を防ぐ。 */
export class AppServerJsonReader {
	private readonly worker: Worker;
	private pending: Pending | undefined;
	private closed = false;
	private stopping: Promise<void> | undefined;

	/** 別ファイルの実行パスに依存せず、通常版・圧縮版とも同じ関数を Worker で実行する。 */
	constructor(
		private readonly input: Readable,
		private readonly receive: (value: unknown) => void,
		private readonly failed: (error: Error) => void,
	) {
		this.worker = new Worker(`(${runAppServerJsonWorker.toString()})()`, {
			eval: true,
			execArgv: [],
		});
		this.worker.on("message", (value: unknown) => {
			const pending = this.pending;
			this.pending = undefined;
			pending?.resolve(value);
		});
		this.worker.on("error", () => this.fail());
		this.worker.on("messageerror", () => this.fail());
		this.worker.on("exit", () => this.fail());
		void this.read();
	}

	/** 保留解析を直ちに解除し、Worker の終了を待てるようにする。 */
	dispose(): Promise<void> {
		if (this.stopping) {
			return this.stopping;
		}
		this.closed = true;
		this.pending?.reject(new Error("Reader closed"));
		this.pending = undefined;
		this.input.destroy();
		this.stopping = this.worker.terminate().then(() => undefined);
		return this.stopping;
	}

	/** パイプの読込みも順次実行し、Host では全文文字列を組み立てない。 */
	private async read() {
		try {
			for await (const chunk of this.input) {
				if (!Buffer.isBuffer(chunk)) {
					throw new Error("Unexpected stream encoding");
				}
				for (let offset = 0; offset < chunk.length; offset += 65536) {
					await this.parse(chunk.subarray(offset, offset + 65536));
				}
			}
			// プロセス終了時も、改行なしの最終応答を配信してから切断を通知する。
			await this.parse(null);
		} catch {
			// 解析・ストリーム・購読先の例外は同じ接続失敗として扱う。
		} finally {
			this.fail();
		}
	}

	/** プールで共有される Buffer を切り離さず、最大 64 KiB の専用領域だけを移譲する。 */
	private async parse(chunk: Buffer | null) {
		if (this.closed) {
			throw new Error("Reader closed");
		}
		const bytes = chunk === null ? null : new Uint8Array(chunk);
		const result: unknown = await new Promise<unknown>(
			(resolve, reject) => {
				this.pending = { resolve, reject };
				this.worker.postMessage(bytes, bytes ? [bytes.buffer] : []);
			},
		);
		if (!isRecord(result) || !Array.isArray(result.values)) {
			throw new Error("Invalid worker response");
		}
		for (const value of result.values as unknown[]) {
			// receive が同期的に dispose する場合もあるため、各応答の配信前に終了を確認する。
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
			if (this.closed) {
				return;
			}
			this.receive(value);
		}
		if (Boolean(result.failed) === true) {
			throw new Error("Invalid JSONL");
		}
	}

	/** Worker の例外内容を公開せず、失敗を一度だけ接続へ通知する。 */
	private fail() {
		if (this.closed) {
			return;
		}
		void this.dispose();
		this.failed(
			new Error(
				"Codex App Server の受信処理が終了したか、データが不正です。",
			),
		);
	}
}

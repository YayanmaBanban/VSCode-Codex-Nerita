// 追記は開いたファイルへ送り、累積結果は最新の一件だけを小分けに書き出す。
import { closeSync, ftruncateSync, openSync, writeSync } from "node:fs";

type Snapshot = {
	text: string;
	chars: number;
	bytes: number;
	done: Promise<void>;
	resolve: () => void;
	timer?: NodeJS.Immediate;
};
type File = { fd: number; bytes: number; snapshot?: Snapshot; error?: Error };

/** 現在の会話の一時ファイルだけを所有し、外部の保存本文は書き換えない。 */
export class ToolOutputWriter {
	private files = new Map<string, File>();

	/** 累積通知を無制限にキューへ積まず、未完了の古いスナップショットを置き換える。 */
	write(path: string, ref: string, text: string, delta: boolean) {
		let file = this.files.get(ref);
		if (!file) {
			file = { fd: openSync(path, "w+"), bytes: 0 };
			this.files.set(ref, file);
		}
		if (delta) {
			this.append(file, text);
			return;
		}
		this.cancel(ref);
		delete file.error;
		let resolve!: () => void;
		const done = new Promise<void>((finished) => {
			resolve = finished;
		});
		const snapshot = { text, chars: 0, bytes: 0, done, resolve };
		file.snapshot = snapshot;
		this.schedule(file, snapshot);
	}

	/** 範囲取得は書込み完了を待ち、古い途中ファイルを読まない。 */
	async ready(ref: string) {
		const file = this.files.get(ref);
		while (file?.snapshot) {
			await file.snapshot.done;
		}
		if (file?.error) {
			throw file.error;
		}
	}

	/** 外部の永続ファイルへ切り替えるときも、古い累積本文を解放する。 */
	cancel(ref: string) {
		const file = this.files.get(ref);
		if (file) {
			delete file.error;
		}
		if (file?.snapshot) {
			clearImmediate(file.snapshot.timer);
			file.snapshot.resolve();
			delete file.snapshot;
		}
	}

	/** 待機中の取得を解放してから、自分で開いたファイルをすべて閉じる。 */
	dispose() {
		for (const [ref, file] of this.files) {
			this.cancel(ref);
			closeSync(file.fd);
		}
		this.files.clear();
	}

	/** 1回の書込みを最大 64 KiB に抑え、停止や別要求のイベントを処理できるようにする。 */
	private schedule(file: File, snapshot: Snapshot) {
		snapshot.timer = setImmediate(() => {
			try {
				this.step(file, snapshot);
				if (file.snapshot) {
					this.schedule(file, snapshot);
				}
			} catch (error) {
				file.error =
					error instanceof Error
						? error
						: new Error("出力を保存できませんでした。");
				delete file.snapshot;
				snapshot.resolve();
			}
		});
	}

	/** 文字列を小分けにエンコードし、全文サイズの追加 Buffer を作らない。 */
	private step(file: File, snapshot: Snapshot) {
		let end = Math.min(snapshot.text.length, snapshot.chars + 16384);
		if (
			end < snapshot.text.length &&
			/[\uD800-\uDBFF]/u.test(snapshot.text[end - 1]!)
		) {
			end--;
		}
		const bytes = Buffer.from(
			snapshot.text.slice(snapshot.chars, end),
			"utf8",
		);
		writeAll(file.fd, bytes, snapshot.bytes);
		snapshot.chars = end;
		snapshot.bytes += bytes.length;
		if (end === snapshot.text.length) {
			ftruncateSync(file.fd, snapshot.bytes);
			file.bytes = snapshot.bytes;
			delete file.snapshot;
			snapshot.resolve();
		}
	}

	/** 通常の delta は小さく、開閉せず追記する。直前の全置換があれば順序を守る。 */
	private append(file: File, text: string) {
		if (file.snapshot) {
			clearImmediate(file.snapshot.timer);
			while (file.snapshot) {
				this.step(file, file.snapshot);
			}
		}
		if (file.error) {
			throw file.error;
		}
		const data = Buffer.from(text, "utf8");
		writeAll(file.fd, data, file.bytes);
		file.bytes += data.length;
	}
}

/** OS が要求より短く書いた場合も、指定位置へ残りを送り切る。 */
function writeAll(fd: number, data: Buffer, offset: number) {
	let written = 0;
	while (written < data.length) {
		const count = writeSync(
			fd,
			data,
			written,
			data.length - written,
			offset + written,
		);
		if (count === 0) {
			throw new Error("出力ファイルに書き込めませんでした。");
		}
		written += count;
	}
}

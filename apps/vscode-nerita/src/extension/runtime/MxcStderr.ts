// SDK が stderr に追記する拒否レポートのポインターをツール出力から分離する。
import { isNonZeroNumber } from "@nerita/shared/valuePredicates";
import { basename, dirname, normalize } from "node:path";
import { z } from "zod";

const marker = '{"type":"captureDenials",';
const pointerSchema = z.object({
	type: z.literal("captureDenials"),
	outputPath: z.string(),
});

/** チャンク境界をまたぐ JSON を処理する。通常の出力は、診断情報の開始マーカーより短い末尾だけを保留する。 */
export class MxcStderr {
	private pending = "";
	constructor(
		private readonly directory: string,
		private readonly emit: (text: string) => void,
	) {}

	write(chunk: string): void {
		this.pending += chunk;
		while (isNonZeroNumber(this.pending.length)) {
			const position = this.pending.indexOf(marker);
			if (position < 0) {
				const length = Math.max(
					0,
					this.pending.length - marker.length + 1,
				);
				this.flush(length);
				return;
			}
			this.flush(position);
			const end = this.pending.indexOf("\n");
			if (end < 0) {
				if (this.pending.length > 131072) {
					this.flush(1);
					continue;
				}
				return;
			}
			const line = this.pending.slice(0, end + 1);
			if (!this.isPointer(line)) {
				this.emit(line);
			}
			this.pending = this.pending.slice(end + 1);
		}
	}

	/** 通常の stderr が改行で終わらなくても全て返す。 */
	end(): void {
		this.flush(this.pending.length);
	}

	private flush(length: number): void {
		if (isNonZeroNumber(length)) {
			this.emit(this.pending.slice(0, length));
		}
		this.pending = this.pending.slice(length);
	}

	/** 子プロセスが出した任意 JSON や別ディレクトリのパスを診断情報と誤認しない。 */
	private isPointer(line: string): boolean {
		try {
			const pointer = pointerSchema.parse(JSON.parse(line));
			const path = normalize(pointer.outputPath);
			return (
				dirname(path).toLowerCase() === this.directory.toLowerCase() &&
				/^denials\.[\w-]+\.json$/.test(basename(path))
			);
		} catch {
			return false;
		}
	}
}

// JSONL の行組立てと解析を Worker 内に閉じ込める。外部変数を参照せず、関数全体を配布する。

/** バンドル後の関数も単独で実行するため、Node.js の依存は関数内で読み込む。 */
export async function runAppServerJsonWorker() {
	const { parentPort } = await import("node:worker_threads");
	if (!parentPort) {
		throw new Error("Worker port unavailable");
	}
	let parts: Buffer[] = [];
	let length = 0;
	let failed = false;

	/** チャンク境界で分割された UTF-8 をバイト列のまま保持し、完成した一行だけをデコードする。 */
	function parseLine() {
		const line = Buffer.concat(parts, length);
		parts = [];
		length = 0;
		return JSON.parse(
			new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
				line,
			),
		) as unknown;
	}

	/** 一度に一チャンクだけ受け取り、完了通知を次の受信の許可として返す。 */
	parentPort.on("message", (chunk: Uint8Array | null) => {
		if (failed) {
			return;
		}
		const values: unknown[] = [];
		try {
			if (chunk === null) {
				if (length > 0) {
					values.push(parseLine());
				}
			} else {
				consume(
					Buffer.from(
						chunk.buffer,
						chunk.byteOffset,
						chunk.byteLength,
					),
					values,
				);
			}
		} catch {
			// JSON の原文や解析例外にはユーザーの出力が含まれるため、Host へ返さない。
			failed = true;
		}
		parentPort.postMessage({ values, failed });
	});

	/** 一チャンク内の複数行も出現順を維持し、末尾の未完行だけを次回へ持ち越す。 */
	function consume(chunk: Buffer, values: unknown[]) {
		let start = 0;
		while (start < chunk.length) {
			const newline = chunk.indexOf(10, start);
			const end = newline < 0 ? chunk.length : newline;
			parts.push(chunk.subarray(start, end));
			length += end - start;
			if (newline < 0) {
				return;
			}
			values.push(parseLine());
			start = newline + 1;
		}
	}
}

// 復元前の ID 照合では本文全体を読み込まず、上限付きで最初の有効な JSON 行を確認する。
import { open } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { isRecord } from "@nerita/shared/validation";

/** SDK の一覧探索と同じ 1 MiB 上限で、空・破損ファイルを初期化前に拒否する。 */
export async function readPiSessionHeader(
	path: string,
	signal: AbortSignal,
): Promise<{ id: string }> {
	signal.throwIfAborted();
	const file = await open(path, "r");
	const decoder = new StringDecoder("utf8");
	const buffer = Buffer.alloc(4096);
	let pending = "";
	try {
		for (let bytes = 0; bytes < 1024 * 1024;) {
			signal.throwIfAborted();
			const { bytesRead } = await file.read(
				buffer,
				0,
				buffer.length,
				null,
			);
			bytes += bytesRead;
			pending += bytesRead
				? decoder.write(buffer.subarray(0, bytesRead))
				: decoder.end();
			const lines = pending.split("\n");
			pending = bytesRead ? lines.pop()! : "";
			const header = firstHeader(lines);
			if (header) {
				signal.throwIfAborted();
				return header;
			}
			if (!bytesRead) {
				break;
			}
		}
		throw new Error(
			"Piの履歴ヘッダーが見つからないか、読込み上限を超えています。",
		);
	} finally {
		await file.close();
	}
}

/** 最初の有効な JSON 行が見つかった時点で、後続本文の走査を止める。 */
function firstHeader(lines: string[]) {
	for (const line of lines) {
		const header = parseHeaderLine(line);
		if (header) {
			return header;
		}
	}
	return;
}

/** SDK と同様に空行と壊れた JSON 行は飛ばすが、別種の有効な行をヘッダー扱いしない。 */
function parseHeaderLine(line: string): { id: string } | undefined {
	let value: unknown;
	try {
		value = JSON.parse(line.trim());
	} catch {
		return;
	}
	if (
		!isRecord(value) ||
		value.type !== "session" ||
		typeof value.id !== "string"
	) {
		throw new Error("Piの履歴ファイルが変更されています。");
	}
	return { id: value.id };
}

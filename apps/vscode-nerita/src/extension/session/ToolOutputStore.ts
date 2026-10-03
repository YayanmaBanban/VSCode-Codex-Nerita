// 現在の会話の出力をファイルへ退避し、短いプレビューと UTF-8 範囲取得を提供する。
import type { ToolSummary } from "@nerita/shared/chatState";
import type {
	ToolOutputRequest,
	ToolOutputResponse,
} from "@nerita/shared/toolOutput";
import { isRecord } from "@nerita/shared/validation";
import { toolKey } from "@nerita/shared/toolUpdates";
import { randomUUID } from "node:crypto";
import {
	closeSync,
	fstatSync,
	lstatSync,
	mkdtempSync,
	openSync,
	readSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ToolOutputWriter } from "./ToolOutputWriter";
import {
	takeToolOutputSource,
	type ToolOutputSource,
} from "./toolOutputSource";

type Entry = {
	ref: string;
	path: string;
	head: string;
	tail: string;
	chars: number;
	bytes: number;
	truncated: boolean;
};

/** 復元時は保存済みイベントから登録し直し、キャッシュを履歴の復元元には使わない。 */
export class ToolOutputStore {
	private directory: string | undefined;
	private entries = new Map<string, Entry>();
	private refs = new Map<string, Entry>();
	private projected = new WeakSet<ToolSummary>();
	private writer = new ToolOutputWriter();
	private adopted = new Map<string, ToolOutputStore>();

	/** 履歴のページを解放する前に、本文の退避完了と書込み失敗を確認する。 */
	async flush(): Promise<void> {
		await Promise.all(
			[...this.refs.keys()].map((ref) => this.writer.ready(ref)),
		);
	}

	/** 完了した子履歴の参照を取り込み、親の会話切替で一緒に破棄する。 */
	adopt(scope: string, store: ToolOutputStore) {
		const previous = this.adopted.get(scope);
		if (previous) {
			for (const ref of previous.refs.keys()) {
				this.refs.delete(ref);
			}
			previous.dispose();
		}
		for (const [ref, entry] of store.refs) {
			this.refs.set(ref, entry);
		}
		this.adopted.set(scope, store);
	}

	/** 全文の別名フィールドも落とし、状態にはプレビューだけを残す。 */
	project(tool: ToolSummary): ToolSummary {
		if (this.projected.has(tool)) {
			return tool;
		}
		const source = takeToolOutputSource(tool) ?? outputSource(tool);
		if (!source) {
			return tool;
		}
		const key = toolKey(tool);
		let entry = this.entries.get(key);
		if (!entry) {
			this.directory ??= mkdtempSync(join(tmpdir(), "nerita-output-"));
			const ref = randomUUID();
			entry = {
				ref,
				path: join(this.directory, ref),
				head: "",
				tail: "",
				chars: 0,
				bytes: 0,
				truncated: false,
			};
			this.entries.set(key, entry);
			this.refs.set(ref, entry);
		}
		this.write(entry, source);
		const result: ToolSummary = {
			...tool,
			output: preview(entry, source),
		};
		delete result.rawOutput;
		delete result.rawItem;
		delete result.content;
		this.projected.add(result);
		return result;
	}

	/** 許可された参照だけを開き、任意パスへのフォールバックは行わない。 */
	async read(request: ToolOutputRequest): Promise<ToolOutputResponse> {
		const response: ToolOutputResponse = {
			type: "tool/outputResult",
			requestId: request.requestId,
			outputRef: request.outputRef,
			text: "",
			offset: request.offset,
			nextOffset: request.offset,
			eof: true,
		};
		const entry = this.refs.get(request.outputRef);
		if (!entry) {
			return {
				...response,
				error: "出力を取得できません。会話を開き直してください。",
			};
		}
		let fd: number | undefined;
		try {
			await this.writer.ready(entry.ref);
			if (this.refs.get(entry.ref) !== entry) {
				throw new Error("Output expired");
			}
			const before = lstatSync(entry.path);
			if (
				!before.isFile() ||
				realpathSync(entry.path) !== resolve(entry.path)
			) {
				throw new Error("Not a regular file");
			}
			fd = openSync(entry.path, "r");
			const stat = fstatSync(fd);
			if (before.ino !== stat.ino || before.dev !== stat.dev) {
				throw new Error("File changed");
			}
			return {
				...response,
				...readRange(fd, stat.size, request.offset, request.limit),
			};
		} catch {
			return {
				...response,
				error: "出力を取得できません。保存元が削除された可能性があります。",
			};
		} finally {
			if (fd !== undefined) {
				closeSync(fd);
			}
		}
	}

	/** セッションの交換時には参照を失効させ、自分で作った一時領域だけを削除する。 */
	dispose() {
		for (const store of this.adopted.values()) {
			store.dispose();
		}
		this.adopted.clear();
		this.writer.dispose();
		this.entries.clear();
		this.refs.clear();
		this.projected = new WeakSet();
		if (this.directory) {
			rmSync(this.directory, { recursive: true, force: true });
		}
		this.directory = undefined;
	}

	/** 追記経路では本文を再構築せず、保持する先頭・末尾に上限を設ける。 */
	private write(entry: Entry, source: ToolOutputSource) {
		if (source.path) {
			this.writer.cancel(entry.ref);
			entry.path = source.path;
		} else {
			// 外部一時ファイルを後続イベントで書き換えない。
			entry.path = join(this.directory!, entry.ref);
			this.writer.write(
				entry.path,
				entry.ref,
				source.text,
				source.delta ?? false,
			);
		}
		entry.head = safeHead(
			source.delta ? entry.head + source.text : source.text,
			2000,
		);
		entry.tail = safeTail(
			source.delta ? entry.tail + source.text : source.text,
			800,
		);
		entry.chars = (source.delta ? entry.chars : 0) + source.text.length;
		entry.bytes =
			(source.delta ? entry.bytes : 0) + Buffer.byteLength(source.text);
		entry.truncated = source.truncated ?? false;
		if (source.path) {
			this.readPreviewEdges(entry);
		}
	}

	/** SDK の途中結果が末尾だけでも、実ファイルから先頭・末尾を少量ずつ取得する。 */
	private readPreviewEdges(entry: Entry) {
		let fd: number | undefined;
		try {
			const before = lstatSync(entry.path);
			if (
				!before.isFile() ||
				realpathSync(entry.path) !== resolve(entry.path)
			) {
				throw new Error("Not a regular file");
			}
			fd = openSync(entry.path, "r");
			const stat = fstatSync(fd);
			if (before.ino !== stat.ino || before.dev !== stat.dev) {
				throw new Error("File changed");
			}
			const size = stat.size;
			const head = readRange(fd, size, 0, 8000);
			const tail = readRange(fd, size, Math.max(0, size - 3200), 3200);
			entry.head = safeHead(head.text, 2000);
			entry.tail = safeTail(tail.text, 800);
			// 文字数は公開せず、プレビューの上限判定にだけ使う。
			entry.chars = head.eof ? head.text.length : 2001;
			entry.bytes = size;
			entry.truncated = false;
		} catch {
			// 書込み途中や削除済みでも、イベントに含まれたプレビューを失わない。
		} finally {
			if (fd !== undefined) {
				closeSync(fd);
			}
		}
	}
}

/** 最大取得量の外まで数バイト確認し、末尾の不完全な文字を次回へ回す。 */
function readRange(
	fd: number,
	size: number,
	requestedOffset: number,
	limit: number,
) {
	const offset = Math.min(requestedOffset, size);
	const bytes = Buffer.alloc(Math.min(limit + 4, size - offset));
	const count = readSync(fd, bytes, 0, bytes.length, offset);
	let start = 0;
	while (start < count && continuation(bytes[start]!)) {
		start++;
	}
	let end = Math.min(count, limit);
	if (offset + end < size) {
		while (end > start && continuation(bytes[end]!)) {
			end--;
		}
	}
	return {
		text: new TextDecoder("utf-8", { fatal: true }).decode(
			bytes.subarray(start, end),
		),
		offset: offset + start,
		nextOffset: offset + end,
		eof: offset + end >= size,
	};
}

/** 通常出力だけを対象とし、差分や推論の専用表示は維持する。 */
function outputSource(tool: ToolSummary): ToolOutputSource | undefined {
	if (
		tool.output ||
		["think", "edit", "search", "web_search", "image"].includes(
			String(tool.kind),
		)
	) {
		return;
	}
	if (
		isRecord(tool.rawOutput) &&
		typeof tool.rawOutput.formatted_output === "string"
	) {
		return { text: tool.rawOutput.formatted_output };
	}
	const text = contentText(tool.content);
	if (text !== undefined) {
		return { text, truncated: tool.resultDisplay?.omitted ?? false };
	}
	if (tool.rawOutput !== undefined) {
		return {
			text:
				typeof tool.rawOutput === "string"
					? tool.rawOutput
					: JSON.stringify(tool.rawOutput, null, 2),
		};
	}
	return;
}

/** テキストだけの結果をまとめ、差分や画像をテキストへ誤変換しない。 */
function contentText(parts: unknown[] | undefined) {
	const texts = parts?.map((part) => {
		if (!isRecord(part)) {
			return undefined;
		}
		const content = isRecord(part.content) ? part.content : part;
		return content.type === "text" && typeof content.text === "string"
			? content.text
			: undefined;
	});
	return texts?.length && texts.every((text) => text !== undefined)
		? texts.join("\n")
		: undefined;
}

/** 正確なサイズが分かる出力だけにバイト数を付ける。 */
function preview(entry: Entry, source: ToolOutputSource) {
	const truncated = entry.truncated || entry.chars > 2000;
	return {
		preview:
			entry.chars > 2000
				? `${safeHead(entry.head, 1200)}\n\n… 出力を省略 …\n\n${safeTail(entry.tail, 800)}`
				: entry.head,
		truncated,
		...(!entry.truncated || source.path ? { outputRef: entry.ref } : {}),
		...(!entry.truncated ? { totalBytes: entry.bytes } : {}),
	};
}

/** UTF-16 のサロゲート対もプレビューの端で分断しない。 */
function safeHead(text: string, limit: number) {
	const end = Math.min(text.length, limit);
	return copyPreview(
		text.slice(
			0,
			end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1] ?? "")
				? end - 1
				: end,
		),
	);
}

/** 末尾プレビューの開始位置をコードポイント境界に合わせる。 */
function safeTail(text: string, limit: number) {
	let start = Math.max(0, text.length - limit);
	if (/[\uDC00-\uDFFF]/u.test(text[start] ?? "")) {
		start++;
	}
	return copyPreview(text.slice(start));
}

/** V8 の部分文字列が巨大な元本文を保持し続けないよう、短い UTF-8 本文へコピーする。 */
function copyPreview(text: string) {
	return Buffer.from(text, "utf8").toString("utf8");
}

/** UTF-8 の継続バイトを判定する。 */
function continuation(byte: number) {
	return (byte & 0xc0) === 0x80;
}

// JSONL に不足する出力本文をセッション配下へ保存し、分岐後も同じ実体を参照する。
import {
	isNonEmptyString,
	isNonZeroNumber,
} from "@nerita/shared/valuePredicates";
import type {
	AgentSession,
	SessionEntry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { initialState, type ToolSummary } from "@nerita/shared/chatState";
import { isRecord } from "@nerita/shared/validation";
import { randomUUID } from "node:crypto";
import { constants, lstatSync, realpathSync } from "node:fs";
import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { mapPiTool } from "../PiToolMapper";
import {
	setToolOutputSource,
	takeToolOutputSource,
	type ToolOutputSource,
} from "../../../session/toolOutputSource";

const customType = "nerita.tool-output.v1";
const safeId = /^[a-f0-9-]{36}$/u;
type OutputRecord = {
	toolId: string;
	turnId: string;
	ownerSessionId: string;
	outputId: string;
	preview: string;
	complete: boolean;
	exitCode?: number;
};

/** 本文の保存完了後にだけ参照を追記し、保存失敗を実行元へ返す。 */
export class PiOutputArchive {
	private pending = new Set<Promise<void>>();
	private failure: Error | undefined;
	private saved = new Map<string, OutputRecord>();
	constructor(
		private manager: SessionManager,
		private directory: string,
	) {}

	/** 前回の保存失敗を次の実行へ持ち越さない。 */
	begin() {
		this.failure = undefined;
		this.saved.clear();
	}

	/** 停止された実行でも、本文の保存失敗は画面へ通知する。 */
	get error(): string | undefined {
		return this.failure?.message;
	}

	/** 完了画面の出力参照も永続ファイルへ切り替え、一時出力が削除されても本文を取得できるようにする。 */
	project(tools: ToolSummary[], runId: string | null): ToolSummary[] {
		return tools.map((tool) => {
			const record =
				tool.runId === runId ? this.saved.get(tool.id) : undefined;
			if (!record) {
				return tool;
			}
			const restored = { ...tool };
			this.restoreTool(restored, record);
			return restored;
		});
	}

	/** 完了した子ツールと、一時ファイルにしか全文がないシェルを保存する。 */
	capture(event: Parameters<Parameters<AgentSession["subscribe"]>[0]>[0]) {
		if (event.type !== "tool_execution_end") {
			return;
		}
		const tool = mapPiTool(event, initialState())?.tools?.[0];
		if (!tool) {
			return;
		}
		const source = takeToolOutputSource(tool) ?? textSource(tool);
		if (
			!source ||
			(!isNonEmptyString(event.parentToolCallId) &&
				!isNonEmptyString(source.path))
		) {
			return;
		}
		const record = this.record(tool, source);
		const operation = this.save(record, source).catch(() => {
			this.failure = new Error(
				"ツール出力を保存できませんでした。保存先の空き容量とアクセス権を確認してください。",
			);
		});
		this.pending.add(operation);
		void operation.then(() => this.pending.delete(operation));
	}

	/** 応答終了・停止・破棄時に、開始済みの保存をすべて待つ。 */
	async flush() {
		await Promise.all(this.pending);
		if (this.failure) {
			throw this.failure;
		}
	}

	/** 選択ブランチのメタデータだけを使い、本文全体を読み込まず参照を復元する。 */
	restore(tools: ToolSummary[], entries: SessionEntry[]) {
		const records = new Map<string, OutputRecord>();
		for (const entry of entries) {
			if (entry.type === "custom" && entry.customType === customType) {
				if (!isOutputRecord(entry.data)) {
					throw new Error(
						"Piのツール出力の保存情報が破損しています。",
					);
				}
				records.set(
					`history:${entry.data.turnId}:${entry.data.toolId}`,
					entry.data,
				);
			}
		}
		for (const tool of tools) {
			const record = records.get(`${tool.runId}:${tool.id}`);
			if (record) {
				this.restoreTool(tool, record);
			}
		}
	}

	/** UUID のみをパス要素に使い、ツール ID に含まれるスラッシュをパスへ流さない。 */
	private record(tool: ToolSummary, source: ToolOutputSource): OutputRecord {
		const turn = this.manager
			.getBranch()
			.reverse()
			.find(
				(entry) =>
					entry.type === "message" && entry.message.role === "user",
			);
		return {
			toolId: tool.id,
			turnId: turn?.id ?? "",
			ownerSessionId: this.manager.getSessionId(),
			outputId: randomUUID(),
			preview: boundedPreview(source.text),
			complete:
				!!isNonEmptyString(source.path) || !(source.truncated === true),
			...(tool.exitCode === undefined ? {} : { exitCode: tool.exitCode }),
		};
	}

	/** 本文を確定してから JSONL に追記する。分岐元のファイルは変更しない。 */
	private async save(record: OutputRecord, source: ToolOutputSource) {
		if (!safeId.test(record.ownerSessionId)) {
			throw new Error("Invalid session ID");
		}
		const folder = await prepareOutputFolder(
			this.directory,
			record.ownerSessionId,
		);
		const path = join(folder, `${record.outputId}.txt`);
		const temporary = `${path}.pending`;
		if (isNonEmptyString(source.path)) {
			assertLocalPath(source.path);
			await copyFile(source.path, temporary, constants.COPYFILE_EXCL);
		} else {
			await writeFile(temporary, source.text, {
				encoding: "utf8",
				flag: "wx",
			});
		}
		await rename(temporary, path);
		this.manager.appendCustomEntry(customType, record);
		this.saved.set(record.toolId, record);
	}

	/** 欠損した本文は保存プレビューで表示し、全文の参照を発行しない。 */
	private restoreTool(tool: ToolSummary, record: OutputRecord) {
		let path: string | undefined;
		try {
			const candidate = join(
				this.directory,
				record.ownerSessionId,
				"outputs",
				`${record.outputId}.txt`,
			);
			assertLocalPath(candidate);
			if (record.complete && lstatSync(candidate).isFile()) {
				path = candidate;
			}
		} catch {
			// 移動・削除された出力があっても会話の復元は継続する。
		}
		tool.summaryOnly = false;
		if (record.exitCode !== undefined) {
			tool.exitCode = record.exitCode;
		}
		setToolOutputSource(tool, {
			text: record.preview,
			truncated: !isNonEmptyString(path),
			...(isNonEmptyString(path) ? { path } : {}),
		});
	}
}

/** SDK のイベント購読は例外を伝播しないため、実行と停止の完了前に保存を待ち、失敗を呼び出し元へ返す。 */
export function bindPiOutputArchive(
	session: AgentSession,
	archive: PiOutputArchive | undefined,
) {
	if (!archive) {
		return;
	}
	const unsubscribe = session.subscribe((event) => archive.capture(event));
	const prompt = session.prompt.bind(session);
	session.prompt = async (...args) => {
		archive.begin();
		try {
			await prompt(...args);
		} finally {
			await archive.flush();
		}
	};
	const abort = session.abort.bind(session);
	session.abort = async () => {
		try {
			await abort();
		} finally {
			await archive.flush();
		}
	};
	const dispose = session.dispose.bind(session);
	session.dispose = () => {
		unsubscribe();
		dispose();
	};
}

/** 表示用に処理済みのテキストだけを保存し、画像や未知の構造化値を直列化しない。 */
function textSource(tool: ToolSummary): ToolOutputSource | undefined {
	const texts = tool.content?.flatMap((part) => {
		if (!isRecord(part) || !isRecord(part.content)) {
			return [];
		}
		return part.content.type === "text" &&
			typeof part.content.text === "string"
			? [part.content.text]
			: [];
	});
	return isNonZeroNumber(texts?.length)
		? {
				text: texts.join("\n"),
				truncated: tool.resultDisplay?.omitted ?? false,
			}
		: undefined;
}

/** リンクされたディレクトリを含む参照を拒否する。 */
function assertLocalPath(path: string) {
	if (realpathSync(path) !== resolve(path)) {
		throw new Error("Output path is linked");
	}
}

/** プレビューも Unicode の文字境界で切り、JSONL のサイズを制限する。 */
function boundedPreview(text: string) {
	if (text.length <= 2000) {
		return text;
	}
	return `${text.slice(0, 1200).replace(/[\uD800-\uDBFF]$/u, "")}\n… 出力を省略 …\n${text.slice(-800).replace(/^[\uDC00-\uDFFF]/u, "")}`;
}

/** 外部編集された履歴から任意パスや巨大プレビューを取り込まない。 */
function isOutputRecord(value: unknown): value is OutputRecord {
	return (
		isRecord(value) &&
		typeof value.toolId === "string" &&
		typeof value.turnId === "string" &&
		isSafeId(value.ownerSessionId) &&
		isSafeId(value.outputId) &&
		typeof value.preview === "string" &&
		value.preview.length <= 2100 &&
		typeof value.complete === "boolean" &&
		(value.exitCode === undefined || Number.isSafeInteger(value.exitCode))
	);
}

/** 保存先の各階層を検証してから次の階層を作る。 */
async function prepareOutputFolder(directory: string, owner: string) {
	assertLocalPath(directory);
	const session = join(directory, owner);
	await mkdir(session, { recursive: true });
	assertLocalPath(session);
	const folder = join(session, "outputs");
	await mkdir(folder, { recursive: true });
	assertLocalPath(folder);
	return folder;
}

/** 保存済みの ID をパス要素として使えるか確認する。 */
function isSafeId(value: unknown): value is string {
	return typeof value === "string" && safeId.test(value);
}

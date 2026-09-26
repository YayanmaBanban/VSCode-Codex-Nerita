// 子の表示履歴を親の JSONL の専用レコードへ保存し、選択ブランチから復元する。
import type {
	SessionEntry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ChatMessage, ToolSummary } from "../../../shared/chatState";
import { isSubAgent, type SubAgentSummary } from "../../../shared/subAgents";
import { validStateField } from "../../../shared/stateFieldValidation";
import { isRecord } from "../../../shared/validation";
import { isAbsolute } from "node:path";

const customType = "nerita.subagent.v1";

/** 本文とツールの更新差分。承認や実行条件は保存しない。 */
export type PiAgentRecord = {
	version: 1;
	cwd: string;
	summary: SubAgentSummary;
	messages: ChatMessage[];
	tools: ToolSummary[];
};

/** SDK のカスタムレコードはモデルの入力文脈に含まれない。 */
export class PiAgentHistory {
	private previous = new Map<string, PiAgentRecord>();
	constructor(
		private readonly manager: Pick<SessionManager, "appendCustomEntry">,
	) {}

	/** 更新された項目だけを保存し、会話全体の繰り返し書込みを避ける。 */
	write(record: PiAgentRecord): void {
		const previous = this.previous.get(record.summary.threadId);
		const messages = changedItems(
			record.messages,
			previous?.messages ?? [],
		);
		const tools = changedItems(record.tools, previous?.tools ?? []);
		this.manager.appendCustomEntry(
			customType,
			structuredClone({ ...record, messages, tools }),
		);
		this.previous.set(record.summary.threadId, structuredClone(record));
	}
}

/** 子の ID ごとに更新を重ね、実行中だった履歴も後段で停止状態へ戻せるようにする。 */
export function restorePiAgentRecords(
	entries: SessionEntry[],
): PiAgentRecord[] {
	const records = new Map<string, PiAgentRecord>();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== customType) {
			continue;
		}
		if (!isAgentRecord(entry.data)) {
			throw new Error("Piの子の履歴が破損しています。");
		}
		const record = entry.data;
		const previous = records.get(record.summary.threadId);
		records.set(record.summary.threadId, {
			...record,
			messages: mergeItems(
				previous?.messages ?? [],
				record.messages,
			).slice(-256),
			tools: mergeItems(previous?.tools ?? [], record.tools).slice(-128),
		});
		if (records.size > 128) {
			throw new Error("Piの子の履歴が保存上限を超えています。");
		}
	}
	return [...records.values()];
}

/** 外部から編集された JSONL も画面の通信と同じ項目検証へ通す。 */
function isAgentRecord(value: unknown): value is PiAgentRecord {
	return (
		isRecord(value) &&
		value.version === 1 &&
		typeof value.cwd === "string" &&
		!isAbsolute(value.cwd) &&
		isSubAgent(value.summary) &&
		validItems("messages", value.messages, 256) &&
		validItems("tools", value.tools, 128)
	);
}

/** 保存する配列の上限と表示項目の形式をまとめて検証する。 */
function validItems(
	field: "messages" | "tools",
	value: unknown,
	limit: number,
) {
	return (
		Array.isArray(value) &&
		value.length <= limit &&
		validStateField(field, value)
	);
}

/** 内容が変わった項目だけを取り出し、既存の順序を保持する。 */
function changedItems<T extends { id: string }>(
	items: T[],
	previous: T[],
): T[] {
	const old = new Map(
		previous.map((item) => [item.id, JSON.stringify(item)]),
	);
	return items.filter((item) => old.get(item.id) !== JSON.stringify(item));
}

/** 保存順に同じ ID の本文・ツール状態を置き換える。 */
function mergeItems<T extends { id: string }>(
	previous: T[],
	changes: T[],
): T[] {
	const items = new Map(previous.map((item) => [item.id, item]));
	for (const item of changes) {
		items.set(item.id, item);
	}
	return [...items.values()];
}

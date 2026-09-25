// 履歴 RPC の応答から、一覧と復元に必要な検証済みフィールドだけを公開する。
import { isRecord } from "../../../../shared/validation";
import {
	parseStartedThread,
	parseTurn,
	type StartedThread,
	type TurnInfo,
} from "./turn";

/** 保存済みターンの本文と読み込み状態。 */
export type HistoryTurn = TurnInfo & {
	items: Record<string, unknown>[];
	itemsView: "notLoaded" | "summary" | "full";
};
/** 履歴操作前に作業フォルダーと稼働状態を照合するメタデータ。 */
export type HistoryThread = {
	id: string;
	cwd: string;
	name: string | null;
	preview: string;
	updatedAt: number;
	active: boolean;
	parentThreadId?: string;
	agentNickname?: string;
	agentRole?: string;
	model?: string;
	reasoningEffort?: string;
	status?: string;
	historyMode: "legacy" | "paginated";
	turns: HistoryTurn[];
};
/** 欠落した必須フィールドを黙って文字列化しない。 */
function text(value: unknown): string {
	if (typeof value !== "string") {
		throw new Error("Invalid history text");
	}
	return value;
}
/** 項目本文は共通の描画変換処理で種別ごとに検証する。 */
function item(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error("Invalid history item");
	}
	text(value.id);
	text(value.type);
	return value;
}
/** 復元するターンを検証する。 */
export function parseHistoryTurn(value: unknown): HistoryTurn {
	const turn = parseTurn(value);
	if (
		!isRecord(value) ||
		!Array.isArray(value.items) ||
		(value.itemsView !== "full" &&
			value.itemsView !== "summary" &&
			value.itemsView !== "notLoaded")
	) {
		throw new Error("Invalid history turn");
	}
	return {
		...turn,
		items: value.items.map(item),
		itemsView: value.itemsView,
	};
}
/** thread/list・read・resume・`fork` で共通のメタデータを検証する。 */
export function parseHistoryThread(value: unknown): HistoryThread {
	if (
		!isRecord(value) ||
		!isRecord(value.status) ||
		!["idle", "active", "notLoaded", "systemError"].includes(
			String(value.status.type),
		) ||
		!Array.isArray(value.turns) ||
		typeof value.updatedAt !== "number" ||
		!Number.isFinite(value.updatedAt) ||
		!isThreadName(value.name) ||
		(value.historyMode !== "legacy" && value.historyMode !== "paginated")
	) {
		throw new Error("Invalid history thread");
	}
	return {
		id: text(value.id),
		...Object.fromEntries(
			[
				"parentThreadId",
				"agentNickname",
				"agentRole",
				"model",
				"reasoningEffort",
			].flatMap((key) => {
				if (value[key] === undefined || value[key] === null) {
					return [];
				}
				return [[key, text(value[key])]];
			}),
		),
		status: String(value.status.type),
		cwd: text(value.cwd),
		name: value.name,
		preview: text(value.preview),
		updatedAt: value.updatedAt,
		active: value.status.type === "active",
		historyMode: value.historyMode,
		turns: value.turns.map(parseHistoryTurn),
	};
}

/** 未命名の会話は `null` として受け付ける。 */
function isThreadName(value: unknown): value is string | null {
	return value === null || typeof value === "string";
}
/** ページ応答の共通外形とカーソルを検証する。 */
function page<T>(
	value: unknown,
	parse: (entry: unknown) => T,
): { data: T[]; nextCursor: string | null } {
	if (
		!isRecord(value) ||
		!Array.isArray(value.data) ||
		!(value.nextCursor === null || typeof value.nextCursor === "string")
	) {
		throw new Error("Invalid history page");
	}
	return { data: value.data.map(parse), nextCursor: value.nextCursor };
}
/** 一覧ページを検証する。 */
export const parseThreads = (value: unknown) => page(value, parseHistoryThread);
/** 保存ターンのページを検証する。 */
export const parseTurns = (value: unknown) => page(value, parseHistoryTurn);
/** ターン内の項目ページを検証する。 */
export const parseItems = (value: unknown) =>
	page(value, (entry) => {
		if (!isRecord(entry)) {
			throw new Error("Invalid history entry");
		}
		return { turnId: text(entry.turnId), item: item(entry.item) };
	});
/** 読み取りとアーカイブ解除は同じスレッド外形を返す。 */
export function parseReadThread(value: unknown): { thread: HistoryThread } {
	if (!isRecord(value)) {
		throw new Error("Invalid thread response");
	}
	return { thread: parseHistoryThread(value.thread) };
}
/** 復元時の設定と保存会話を合わせて検証する。 */
export function parseResumedThread(
	value: unknown,
): StartedThread & { thread: HistoryThread } {
	return { ...parseStartedThread(value), ...parseReadThread(value) };
}

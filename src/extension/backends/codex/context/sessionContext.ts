// 他の会話を再開・変更せず、本文だけを上限付きの参照資料として読み込む。
import type { CodexConnection } from "../runtime/connection";
import type { HistoryThread } from "../protocol/history";
import { sameCwd } from "../../../workspace";
import { hydrateHistory, replayHistory } from "../history/restoreHistory";

/** ユーザーに再試行・参照解除を案内できる読み込み失敗。 */
export class SessionContextError extends Error {
	/** 生の RPC エラーや会話本文をエラー表示へ漏らさない。 */
	constructor() {
		super(
			"参照セッションを読み込めませんでした。同じ作業フォルダーの終了済みセッションを選び直すか、参照を外して再送してください。",
		);
	}
}

/** 古い接続・別 `cwd`・実行中の会話を参照しない。 */
function checkThread(
	thread: HistoryThread,
	id: string,
	cwd: string,
	current: () => boolean,
): void {
	if (
		!current() ||
		thread.id !== id ||
		!sameCwd(thread.cwd, cwd) ||
		thread.active
	) {
		throw new SessionContextError();
	}
}

/** 復元用のページ取得を借り、通信量とページ数に参照専用の上限を設ける。 */
export async function readSessionContext(
	client: CodexConnection,
	id: string,
	cwd: string,
	current: () => boolean,
	mode: "transcript" | "handoff" = "transcript",
): Promise<string> {
	try {
		if (!current()) {
			throw new SessionContextError();
		}
		let { thread } = await client.readThread(id);
		checkThread(thread, id, cwd, current);
		if (thread.historyMode === "legacy") {
			({ thread } = await client.readThread(id, true));
			checkThread(thread, id, cwd, current);
		}
		const updatedAt = thread.updatedAt;
		let bytes = 0;
		let pages = 0;
		/** 異常に大きい参照を途中で打ち切り、不完全な資料を黙って送らない。 */
		const account = <T>(value: T): T => {
			bytes += Buffer.byteLength(JSON.stringify(value), "utf8");
			if (!current() || bytes > 2_000_000 || ++pages > 20) {
				throw new SessionContextError();
			}
			return value;
		};
		account(thread);
		const turns = await hydrateHistory(
			{
				listTurns: async (threadId, cursor) =>
					account(await client.listTurns(threadId, cursor)),
				listItems: async (threadId, turnId, cursor) =>
					account(await client.listItems(threadId, turnId, cursor)),
			},
			thread,
			current,
		);
		const latest = await client.readThread(id);
		checkThread(latest.thread, id, cwd, current);
		if (latest.thread.updatedAt !== updatedAt) {
			throw new SessionContextError();
		}
		const text = replayHistory(turns)
			.messages.map((message) => `${message.role}:\n${message.text}`)
			.join("\n\n");
		if (!text.trim()) {
			throw new SessionContextError();
		}
		const header = `Referenced session: ${thread.name?.trim() || thread.preview || id}\nSession ID: ${id}\nWorking directory: ${thread.cwd}\nScope: user and assistant messages; tool logs and attachment binaries are omitted.\n`;
		// 大きい会話は直近部分を使い、省略をモデルにも明示する。
		return header + referenceText(text, mode);
	} catch {
		throw new SessionContextError();
	}
}

/** 原文参照だけを直近の文字数に制限し、要約生成には取得できた履歴全体を渡す。 */
function referenceText(text: string, mode: "transcript" | "handoff") {
	return mode === "transcript" && text.length > 40_000
		? `[Earlier content omitted; latest 40,000 characters follow]\n\n${text.slice(-40_000)}`
		: `\n${text}`;
}

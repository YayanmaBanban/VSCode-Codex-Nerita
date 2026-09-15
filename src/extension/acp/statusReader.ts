// /status の文章を内部で収集し、利用枠だけを抽出する。
import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { QuotaWindow } from "../../shared/composer";

/** アダプターの既知の利用枠行だけを受理し、未知の形式を推測しない。 */
export function parseStatus(text: string): QuotaWindow[] {
	const windows: QuotaWindow[] = [];
	for (const line of text.split(/\r?\n/)) {
		const match =
			/^\*\*([^*]+(?:limit|Limit)):\*\*\s+([\d.]+)% left(.*)$/.exec(
				line.trim(),
			);
		if (!match) {
			continue;
		}
		const remaining = Number(match[2]);
		if (!Number.isFinite(remaining) || remaining < 0 || remaining > 100) {
			throw new Error("invalid percentage");
		}
		windows.push({ label: match[1]!, remaining, detail: match[3]!.trim() });
	}
	if (!windows.length) {
		throw new Error("missing quota windows");
	}
	return windows;
}

/** 通常のプロンプトと内部取得を同じキューに置き、通知を混在させない。 */
export class StatusReader {
	private tail: Promise<unknown> = Promise.resolve();
	private capture: { sessionId: string; text: string } | undefined;
	/** 前の要求が成功・失敗のどちらでも次の要求へ進む。 */
	serial<T>(operation: () => Promise<T>): Promise<T> {
		const next = this.tail.then(operation, operation);
		this.tail = next.catch(() => undefined);
		return next;
	}
	/** 会話に関係する内部通知を消費し、設定・使用量通知は通常通り通す。 */
	consume(notification: SessionNotification): boolean {
		if (notification.sessionId !== this.capture?.sessionId) {
			return false;
		}
		const update = notification.update;
		if (
			[
				"usage_update",
				"config_option_update",
				"current_mode_update",
			].includes(update.sessionUpdate)
		) {
			return false;
		}
		if (
			update.sessionUpdate === "agent_message_chunk" &&
			update.content.type === "text"
		) {
			// 想定外の大量出力も履歴やログへ流さない。
			this.capture.text = (this.capture.text + update.content.text).slice(
				0,
				65536,
			);
		}
		return true;
	}
	/** 応答文には個人情報が含まれるため、失敗ログは理由の分類だけにする。 */
	read(
		sessionId: string,
		request: () => Promise<unknown>,
		log: (message: string) => void,
	): Promise<QuotaWindow[] | null> {
		return this.serial(async () => {
			this.capture = { sessionId, text: "" };
			let received = false;
			try {
				await request();
				received = true;
				return parseStatus(this.capture.text);
			} catch {
				log(
					`/status 利用枠取得失敗: ${received ? "応答形式を解析できません" : "通信エラーまたはタイムアウト"}`,
				);
				return null;
			} finally {
				this.capture = undefined;
			}
		});
	}
}

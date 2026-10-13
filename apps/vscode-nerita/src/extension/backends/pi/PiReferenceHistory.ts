// 実際に保存されるユーザー本文の直前へ参照レコードを追加し、履歴の親 ID で対応付ける。
import type {
	AgentSession,
	ExtensionAPI,
	InlineExtension,
	MessageEndEvent,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import {
	validReferences,
	type ComposerReference,
} from "@nerita/shared/composerReferences";
import { isRecord } from "@nerita/shared/validation";

const customType = "nerita.references.v1";

/** 受付後もキュー内に留まる入力を、実際のユーザーメッセージ保存まで保持する。 */
export class PiReferenceHistory {
	private pending: { text: string; references: ComposerReference[] }[] = [];

	/** 準備と保存で本文を照合する。処理済み・失敗した入力は返した関数で取り除く。 */
	prepare(text: string, references: ComposerReference[]): () => void {
		const record = { text, references: structuredClone(references) };
		this.pending.push(record);
		return () => {
			this.pending = this.pending.filter((item) => item !== record);
		};
	}

	/** キューを破棄した入力を、後の同一本文に誤って結び付けない。 */
	clear(): void {
		this.pending = [];
	}

	/** SDK のキュー削除と表示用メタデータの削除を同じ操作へ接続する。 */
	wrapQueue(
		clearQueue: AgentSession["clearQueue"],
	): AgentSession["clearQueue"] {
		return () => {
			this.clear();
			return clearQueue();
		};
	}

	/** 本文の変更・秘密値保護の後に参照情報を記録し、保存される本文と対応付ける。 */
	extension(): InlineExtension {
		return {
			name: "nerita-reference-history",
			hidden: true,
			factory: (pi) => {
				pi.on("message_end", (event) => this.record(pi, event.message));
				pi.on("session_shutdown", () => this.clear());
			},
		};
	}

	/** SDK は `message_end` のハンドラー完了後に本文を保存し、この参照レコードを親 ID にする。 */
	private record(
		pi: ExtensionAPI,
		message: MessageEndEvent["message"],
	): void {
		if (message.role !== "user") {
			return;
		}
		const pending = this.pending.shift();
		if (!pending || pending.references.length === 0) {
			return;
		}
		const text =
			typeof message.content === "string"
				? message.content
				: message.content
						.filter((part) => part.type === "text")
						.map((part) => part.text)
						.join("");
		const matches =
			pending.text === text && validReferences(text, pending.references);
		if (!matches) {
			return;
		}
		pi.appendEntry(customType, {
			version: 1,
			text,
			references: pending.references,
		});
	}
}

/** 本文の直前に保存されたレコードだけを復元し、破損したメタデータは本文表示へ戻す。 */
export function restorePiReferences(
	entry: SessionEntry | undefined,
	text: string,
): ComposerReference[] | undefined {
	if (entry?.type !== "custom" || entry.customType !== customType) {
		return;
	}
	const data = entry.data;
	if (!isRecord(data) || data.version !== 1 || data.text !== text) {
		return;
	}
	if (!validReferences(text, data.references)) {
		return;
	}
	return data.references;
}

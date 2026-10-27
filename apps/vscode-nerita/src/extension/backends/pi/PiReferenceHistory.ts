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
import type { Attachment } from "@nerita/shared/composer";
import { validAttachments } from "@nerita/shared/composerValidation";

const customType = "nerita.references.v1";

/** 受付後もキュー内に留まる入力を、実際のユーザーメッセージ保存まで保持する。 */
export class PiReferenceHistory {
	private pending: {
		text: string;
		displayText: string;
		references: ComposerReference[];
		attachments: Attachment[];
	}[] = [];

	/** 準備と保存で本文を照合する。処理済み・失敗した入力は返した関数で取り除く。 */
	prepare(
		text: string,
		references: ComposerReference[],
		displayText = text,
		attachments: Attachment[] = [],
	): () => void {
		const record = {
			text,
			displayText,
			references: structuredClone(references),
			attachments: structuredClone(attachments),
		};
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
		if (!pending) {
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
			promptTextMatches(pending.text, text) &&
			validReferences(pending.displayText, pending.references);
		if (!matches) {
			return;
		}
		pi.appendEntry(customType, {
			version: 1,
			text,
			displayText: pending.displayText,
			references: pending.references,
			attachments: pending.attachments,
		});
	}
}

/** SDK が画像の正規化で末尾へ加える寸法注記は、元の入力の記録へ結び付ける。 */
function promptTextMatches(expected: string, actual: string): boolean {
	if (expected === actual) {
		return true;
	}
	return (
		actual.startsWith(expected) &&
		/^\n\n\[Image(?::| omitted:)/.test(actual.slice(expected.length))
	);
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
	const displayText =
		typeof data.displayText === "string" ? data.displayText : text;
	if (!validReferences(displayText, data.references)) {
		return;
	}
	return data.references;
}

/** モデルへ追加した資料を本文表示から分け、添付の参照も再接続後へ引き継ぐ。 */
export function restorePiPrompt(entry: SessionEntry | undefined, text: string) {
	const references = restorePiReferences(entry, text);
	const data = entry?.type === "custom" ? entry.data : undefined;
	if (!references || !isRecord(data)) {
		return { text, ...(references ? { references } : {}) };
	}
	const displayText = data.displayText;
	if (typeof displayText !== "string") {
		return { text, references };
	}
	const attachments = validAttachments(data.attachments)
		? data.attachments
		: [];
	return { text: displayText, references, attachments };
}

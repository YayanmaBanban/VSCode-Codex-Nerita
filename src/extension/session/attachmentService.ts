// ファイル選択・ドロップ・表示の Host サービスをバックエンド非依存で定義する。
import type { Attachment } from "../../shared/composer";
import type { DroppedAttachment } from "../../shared/attachmentDrop";

/** 検証済みのローカルファイル参照を扱う。 */
export type AttachmentService = {
	pick: () => Promise<Attachment[]>;
	drop?: (files: DroppedAttachment[]) => Promise<Attachment[]>;
	open: (file: Attachment) => Promise<void>;
};

// 入力欄で使う設定・使用量・添付の通信型を実行環境から独立させる。
import type { DroppedAttachment } from "./attachmentDrop";
/** サーバーが提供する選択肢の表示名と送信値。 */
export type ConfigChoice = {
	value: string;
	name: string;
	description?: string;
};
/** サーバーが提供する選択設定を UI 用に正規化した情報。 */
export type ConfigOption = {
	id: string;
	name: string;
	description?: string;
	currentValue: string;
	options: ConfigChoice[];
};
/** セッション全体のコンテキスト使用量。 */
export type ContextUsage = { used: number; size: number };
/** /status が返す利用枠の残率と表示用のリセット情報。 */
export type QuotaWindow = { label: string; remaining: number; detail: string };
/** Hostで選択またはドロップから取得した添付参照。 */
export type Attachment = { id: string; name: string; uri: string };
/** 入力欄から Host へ送る、セッションに限定した操作。 */
export type ComposerMessage =
	| {
			type: "config/set";
			requestId: string;
			sessionId: string;
			configId: string;
			value: string;
	  }
	| {
			type: "attachment/add";
			requestId: string;
			sessionId: string;
			files?: DroppedAttachment[];
	  }
	| {
			type: "attachment/open";
			requestId: string;
			sessionId: string;
			attachmentId: string;
	  }
	| {
			type: "attachment/remove";
			requestId: string;
			sessionId: string;
			attachmentId: string;
	  };

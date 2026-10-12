// 表示用の型と文書変換を共有し、各入力欄では状態を複製しない。

import {
	type TrustBridge,
	type TrustRequest,
} from "@nerita/shared/workspaceTrust";

import "../chat/chat.css";

/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export const buttonStyle =
	"rounded border border-input-border px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-50 focus-visible:outline focus-visible:outline-2";
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export const origins = {
	workspace: "ワークスペース",
	external: "外部フォルダー",
	"external-cache": "外部キャッシュ",
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type TrustManagerProps = { bridge: TrustBridge };
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type TrustRecordProps = {
	record: {
		root: string;
		trust: "trusted" | "untrusted";
		origin: "workspace" | "external" | "external-cache";
		updatedAt: number;
	};
	busy: boolean;
	send: (message: TrustRequest) => void;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type TrustManagerHeaderProps = {
	busy: boolean;
	send: (message: TrustRequest) => void;
};

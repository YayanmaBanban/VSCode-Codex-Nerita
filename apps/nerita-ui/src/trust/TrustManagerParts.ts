// 信頼記録の表示と操作に使う入力型、登録元の表示名、共通スタイルを定義する。

import {
	type TrustBridge,
	type TrustRequest,
} from "@nerita/shared/workspaceTrust";

import "../chat/chat.css";

/** 操作ボタンの枠と、フォーカス・無効状態の表示を揃える。 */
export const buttonStyle =
	"rounded border border-input-border px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-50 focus-visible:outline focus-visible:outline-2";
/** 信頼記録の登録元を管理画面の表示名へ変換する。 */
export const origins = {
	workspace: "ワークスペース",
	external: "外部フォルダー",
	"external-cache": "外部キャッシュ",
};
/** 信頼記録の取得と、追加・変更・削除に使う通信窓口。 */
export type TrustManagerProps = { bridge: TrustBridge };
/** フォルダーの信頼記録と、その記録を変更・削除する要求の送信先。 */
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
/** 信頼記録の追加・再取得に使う要求の送信先と待機状態。 */
export type TrustManagerHeaderProps = {
	busy: boolean;
	send: (message: TrustRequest) => void;
};

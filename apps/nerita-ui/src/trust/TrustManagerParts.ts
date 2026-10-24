// 信頼記録の表示と操作に使う入力型、登録元の表示名、共通スタイルを定義する。

import {
	type TrustBridge,
	type TrustRequest,
	type TrustReply,
} from "@nerita/shared/workspaceTrust";
import type { BackendId } from "@nerita/shared/backend";

import "../chat/chat.css";

/** 操作ボタンの枠と、フォーカス・無効状態の表示を揃える。 */
export const buttonStyle =
	"rounded-full border border-input-border bg-transparent px-3 py-1 text-[12px] text-primary-text font-medium whitespace-nowrap enabled:hover:bg-settings-hover disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
/** 検索欄と高さを揃え、操作をツールチップで説明する四角いボタン。 */
export const iconButtonStyle =
	"inline-flex size-9 shrink-0 items-center justify-center rounded border border-input-border bg-transparent p-0 text-foreground enabled:hover:bg-settings-hover disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
/** 信頼記録の登録元を管理画面の表示名へ変換する。 */
export const origins = {
	workspace: "ワークスペース",
	external: "外部フォルダ",
	"external-cache": "外部キャッシュ",
};
/** 信頼記録の取得と、追加・変更・削除に使う通信窓口。 */
export type TrustManagerProps = { bridge: TrustBridge };
/** フォルダの信頼記録と、その記録を変更・削除する要求の送信先。 */
export type TrustRecordProps = {
	record: TrustReply["records"][number];
	busy: boolean;
	send: (message: TrustRequest) => void;
};
/** バックエンドの切替に使う要求の送信先と待機状態。 */
export type TrustManagerHeaderProps = {
	backend: BackendId;
	piStoragePath?: string | undefined;
	busy: boolean;
	send: (message: TrustRequest) => void;
};

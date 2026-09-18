// 同梱Codex 0.154.0の試験的スキーマにある追加コンテキストだけを型に補う。
import type { TurnStartParams } from "../../codex-app-server/v2/TurnStartParams";
import type { TurnSteerParams } from "../../codex-app-server/v2/TurnSteerParams";
/** 外部会話は指示として昇格させず、信頼しない資料として渡す。 */
export type AdditionalContext = Record<
	string,
	{ value: string; kind: "untrusted" }
>;
/** 安定版の生成型を手編集せず、利用する試験的フィールドを追加する。 */
export type ContextTurnStartParams = TurnStartParams & {
	additionalContext?: AdditionalContext;
};
/** 実行中の追加指示にも同じ参照資料を添えられる。 */
export type ContextTurnSteerParams = TurnSteerParams & {
	additionalContext?: AdditionalContext;
};

// 送信前の入力と終了後の表示を分離し、再開時も実際の全文と参照を復元する。
import { z } from "zod";
import { isState } from "@nerita/shared/stateValidation";
import type { ChatState } from "@nerita/shared/chatState";
import { ExecutionRequestSchema } from "@nerita/dlc/runtime";
import { FrozenKnowledgeSchema } from "./FrozenKnowledge";

/** UTF-8 で保存・読み込む実行記録の上限バイト数。JSON のエスケープ・整形・末尾改行も含む。 */
export const runRecordLimit = 16 * 1024 * 1024;

export const RunContextSchema = z.strictObject({
	schemaVersion: z.literal(1),
	request: ExecutionRequestSchema,
	backend: z.enum(["pi", "codex"]),
	executionDirectory: z.string().min(1),
	prompt: z
		.string()
		.min(1)
		.max(3 * 1024 * 1024),
	knowledge: FrozenKnowledgeSchema,
});
export type RunContext = z.infer<typeof RunContextSchema>;
export const RunConversationSchema = z.custom<ChatState>(
	isState,
	"実行の会話記録が不正です。",
);

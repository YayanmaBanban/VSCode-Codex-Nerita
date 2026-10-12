// 個人の環境に依存しない表示データと、Host 通知を注入する操作。
import type { ChatMessage } from "@nerita/shared/chatState";
export const messages: ChatMessage[] = Array.from({ length: 8 }, (_, index) => [
	{
		id: `user-${index}`,
		role: "user" as const,
		text: `確認対象 ${index}\n\n${"本文と **設定** を確認してください。\n".repeat(800)}`,
	},
	{
		id: `assistant-${index}`,
		role: "assistant" as const,
		text: `確認結果 ${index}。詳細は [資料 ${index}](https://example.test/details/${index}) を参照してください。`,
	},
]).flat();

// 実 SDK の会話ループへ、検証対象のツール選択だけを模擬応答として渡す。
import type { AgentSession } from "@earendil-works/pi-coding-agent";

/** プロバイダー通信を使わず、Host の承認・実通信・保存は本番処理を通す。 */
export function piScriptedTools(
	session: AgentSession,
	calls: { name: string; arguments: Record<string, unknown> }[],
): void {
	let turn = 0;
	session.agent.streamFunction = (model) => {
		const call = calls[turn++];
		const message = {
			role: "assistant" as const,
			api: model.api,
			provider: model.provider,
			model: model.id,
			content: call
				? [{ type: "toolCall" as const, id: `turn-${turn}`, ...call }]
				: [{ type: "text" as const, text: "done" }],
			stopReason: call ? ("toolUse" as const) : ("stop" as const),
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0,
				},
			},
			timestamp: Date.now(),
		};
		return {
			async *[Symbol.asyncIterator]() {
				await Promise.resolve();
				yield { type: "start", partial: message };
				yield { type: "done", reason: message.stopReason, message };
			},
			result: () => Promise.resolve(message),
		} as unknown as ReturnType<typeof session.agent.streamFunction>;
	};
}

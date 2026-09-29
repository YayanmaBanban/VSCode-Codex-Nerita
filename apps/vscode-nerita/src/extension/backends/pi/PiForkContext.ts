// 起動要求時点の会話を固定し、未完了のツール交換とカスタム実行情報を除く。
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { PiModelSelection } from "./PiRuntime";

/** SDK が子の初期会話として受け付ける標準メッセージ。 */
export type PiForkMessage = Parameters<SessionManager["appendMessage"]>[0];

/** 異なるモデルへの文脈移植は拒否し、完了したツール交換だけを残す。 */
export function forkContext(
	manager: Pick<SessionManager, "buildSessionContext">,
	parent: { provider: string; id: string },
	target: PiModelSelection,
): PiForkMessage[] {
	validateModel(parent, target);
	const messages = manager.buildSessionContext().messages;
	const results = new Set(
		messages
			.filter((message) => message.role === "toolResult")
			.map((message) => message.toolCallId),
	);
	const accepted = new Set<string>();
	const snapshot: PiForkMessage[] = [];
	for (const message of messages) {
		if (message.role === "user") {
			snapshot.push(message);
		}
		if (message.role === "assistant") {
			const calls = message.content.filter(
				(part) => part.type === "toolCall",
			);
			if (calls.some((call) => !results.has(call.id))) {
				continue;
			}
			for (const call of calls) {
				accepted.add(call.id);
			}
			snapshot.push(message);
		}
		if (message.role === "toolResult" && accepted.has(message.toolCallId)) {
			snapshot.push(message);
		}
	}
	return boundedSnapshot(snapshot);
}

/** モデル固有の会話形式を別のモデルへ渡さない。 */
function validateModel(
	parent: { provider: string; id: string },
	target: PiModelSelection,
) {
	if (parent.provider !== target.provider || parent.id !== target.model) {
		throw new Error(
			"fork は親と同じモデル・プロバイダーだけを使用できます。",
		);
	}
}

/** 待機中に親が更新されても子の入力は変わらない。 */
function boundedSnapshot(snapshot: PiForkMessage[]) {
	if (
		snapshot.length > 1024 ||
		JSON.stringify(snapshot).length > 4 * 1024 * 1024
	) {
		throw new Error(
			"複製する親の会話が上限を超えています。fresh を使用してください。",
		);
	}
	return structuredClone(snapshot);
}

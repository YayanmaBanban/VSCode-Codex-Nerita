// 要約専用の一時接続で生成し、表示中の会話や参照元を変更しない。
import type { CodexFactory, CodexConnection } from "../runtime/connection";
import type { HandoffRequest } from "../../../session/HandoffContext";
import { isRecord } from "../../../../shared/validation";

/** 成功・失敗・取消のいずれでも専用プロセスを終了する。 */
export async function generateCodexHandoff(
	factory: CodexFactory,
	cwd: string,
	request: HandoffRequest,
): Promise<string> {
	let client: CodexConnection | undefined;
	let threadId: string | undefined;
	let resolveResult!: (text: string) => void;
	let rejectResult!: (error: Error) => void;
	const texts = new Map<string, string>();
	const done = new Promise<string>((resolve, reject) => {
		resolveResult = resolve;
		rejectResult = reject;
	});
	// 接続準備中の取消でも未処理の拒否を残さない。
	void done.catch(() => {});
	const abort = () => rejectResult(new Error("Handoff cancelled"));
	request.signal.addEventListener("abort", abort, { once: true });
	try {
		request.signal.throwIfAborted();
		({ client } = await factory(
			{
				notification: ({ method, params }) => {
					if (!isRecord(params) || params.threadId !== threadId) {
						return;
					}
					if (method === "item/completed") {
						collectHandoffText(params.item, texts);
					}
					if (method === "turn/completed" && isRecord(params.turn)) {
						if (params.turn.status === "completed") {
							resolveResult([...texts.values()].join("\n"));
						} else {
							rejectResult(new Error("Handoff failed"));
						}
					}
				},
				request: () => Promise.resolve({ decision: "decline" }),
				disconnected: rejectResult,
			},
			request.signal,
		));
		request.signal.throwIfAborted();
		const result = await client.startThread({
			cwd,
			model: request.model,
			ephemeral: true,
			sandbox: "read-only",
			approvalPolicy: "never",
			baseInstructions: request.systemPrompt,
			config: { tools: { shell: false }, web_search: "disabled" },
		});
		threadId = result.thread.id;
		request.signal.throwIfAborted();
		await client.startTurn({
			threadId,
			model: request.model,
			...(request.effort ? { effort: request.effort } : {}),
			input: [{ type: "text", text: request.prompt, text_elements: [] }],
		});
		return await done;
	} finally {
		request.signal.removeEventListener("abort", abort);
		await client?.dispose();
	}
}

/** 完了したアシスタント本文だけを要約として採用する。 */
function collectHandoffText(value: unknown, texts: Map<string, string>) {
	if (
		isRecord(value) &&
		value.type === "agentMessage" &&
		typeof value.id === "string" &&
		typeof value.text === "string"
	) {
		texts.set(value.id, value.text);
	}
}

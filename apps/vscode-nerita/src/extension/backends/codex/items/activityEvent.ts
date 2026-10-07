// 活動通知を入口で検証し、描画用の更新処理へ具体的なデータだけを渡す。
import { z } from "zod";
import { fileChanges } from "./activityItems";
import type { ToolContent } from "@nerita/shared/toolContent";

/** 判別子ごとに、更新に必要なフィールドを保証する。 */
export type ActivityUpdate = { id: string } & (
	| { kind: "diff"; diff: string }
	| { kind: "plan"; plan: { status: string; step: string }[] }
	| { kind: "changes"; paths: string[]; content: ToolContent[] }
	| { kind: "stdin"; stdin: string }
	| { kind: "progress"; message: string }
	| {
			kind: "reasoning";
			section: "summary" | "content";
			index: number;
			added: boolean;
			delta: string;
	  }
	| { kind: "output"; command: boolean; delta: string }
);

/** 識別子と本文を検証して具体型で返し、適用側での再検査を不要にする。 */
export function parseActivityUpdate(
	method: string,
	params: Record<string, unknown>,
): ActivityUpdate {
	const text = z.string();
	const id = method.startsWith("turn/")
		? `turn:${method}`
		: text.parse(params.itemId);
	if (method === "turn/diff/updated") {
		return { id, kind: "diff", diff: text.parse(params.diff) };
	}
	if (method === "turn/plan/updated") {
		return {
			id,
			kind: "plan",
			plan: z
				.array(z.object({ status: text, step: text }))
				.parse(params.plan),
		};
	}
	if (method === "item/fileChange/patchUpdated") {
		return { id, kind: "changes", ...fileChanges(params.changes) };
	}
	if (method === "item/commandExecution/terminalInteraction") {
		return { id, kind: "stdin", stdin: text.parse(params.stdin) };
	}
	if (method === "item/mcpToolCall/progress") {
		return { id, kind: "progress", message: text.parse(params.message) };
	}
	if (method.includes("reasoning")) {
		return parseReasoningUpdate(id, method, params);
	}
	return {
		id,
		kind: "output",
		command: method === "item/commandExecution/outputDelta",
		delta: text.parse(params.delta),
	};
}

/** 推論のセクション追加には本文がなく、差分には本文を必須とする。 */
function parseReasoningUpdate(
	id: string,
	method: string,
	params: Record<string, unknown>,
): ActivityUpdate {
	const added = method.endsWith("summaryPartAdded");
	return {
		id,
		kind: "reasoning",
		section: method.includes("summary") ? "summary" : "content",
		index: z
			.number()
			.int()
			.nonnegative()
			.parse(params.summaryIndex ?? params.contentIndex),
		added,
		delta: added ? "" : z.string().parse(params.delta),
	};
}

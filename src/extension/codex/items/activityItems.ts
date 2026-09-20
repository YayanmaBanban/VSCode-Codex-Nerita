// 推論・計画・MCPなどの完了項目を、共通ツールカードへ正規化する。
import type { ToolSummary } from "../../../shared/chatState";
import { isRecord } from "../../../shared/validation";

/** テキストを実行しない表示用コンテンツで包む。 */
export const textContent = (text: string) => ({
	type: "content",
	content: { type: "text", text },
});
/** コマンドと編集以外のApp Server項目を表示用に変換する。 */
export function activityItem(
	value: Record<string, unknown>,
): Partial<ToolSummary> | null {
	const type = value.type;
	if (
		type === "userMessage" ||
		type === "agentMessage" ||
		type === "commandExecution" ||
		type === "fileChange" ||
		type === "hookPrompt" ||
		type === "subAgentActivity" ||
		type === "collabAgentToolCall"
	) {
		return null;
	}
	const title = typeof value.tool === "string" ? value.tool : String(type);
	const base: Partial<ToolSummary> = { title, kind: "other" };
	if (type === "reasoning") {
		const summary = strings(value.summary),
			content = strings(value.content);
		if (summary.length === 0 && content.length === 0) {
			return null;
		}
		return {
			title: "推論",
			kind: "think",
			content: [textContent([...summary, ...content].join("\n\n"))],
		};
	}
	if (type === "plan") {
		return {
			title: "計画",
			kind: "think",
			content: [textContent(string(value.text))],
		};
	}
	if (type === "mcpToolCall") {
		return {
			...base,
			title: `${string(value.server)} / ${string(value.tool)}`,
			rawInput: value.arguments,
			rawOutput: value.error ?? value.result ?? "実行中",
		};
	}
	if (type === "dynamicToolCall") {
		return {
			...base,
			rawInput: value.arguments,
			rawOutput: value.contentItems ?? "実行中",
		};
	}
	if (type === "webSearch") {
		return {
			title: "Web検索",
			kind: "search",
			rawInput: value.query ?? value.action,
			rawOutput: value.action,
		};
	}
	if (type === "imageView") {
		return {
			title: "画像を確認",
			kind: "read",
			paths: [string(value.path)],
		};
	}
	if (type === "imageGeneration") {
		return {
			title: "画像生成",
			kind: "other",
			rawOutput: value.result ?? value.revisedPrompt,
		};
	}
	if (type === "contextCompaction") {
		return { title: "コンテキスト圧縮", kind: "think" };
	}
	if (type === "enteredReviewMode" || type === "exitedReviewMode") {
		return {
			title: "レビュー",
			content: [textContent(string(value.review))],
		};
	}
	if (type === "functionCallOutput") {
		return { ...base, title: String(value.name), rawOutput: value.output };
	}
	if (type === "sleep") {
		return {
			...base,
			title: "待機",
			rawOutput: value,
		};
	}
	// 新しい項目種別も捨てず、受信した構造をカードで確認できるようにする。
	return { ...base, rawOutput: value };
}
/** 不正な本文を文字列化して表示せず、接続側で検出する。 */
function string(value: unknown): string {
	if (typeof value !== "string") {
		throw new Error("Invalid item text");
	}
	return value;
}
/** 分割された推論本文を検証する。 */
function strings(value: unknown): string[] {
	if (!Array.isArray(value)) {
		throw new Error("Invalid reasoning");
	}
	return value.map(string);
}
/** unified diffを前後本文へ再構築せず、そのままの差分として保持する。 */
export function fileChanges(changes: unknown): {
	paths: string[];
	content: unknown[];
} {
	if (!Array.isArray(changes)) {
		throw new Error("Invalid file changes");
	}
	const paths: string[] = [];
	const content = changes.map((change: unknown) => {
		if (!isRecord(change)) {
			throw new Error("Invalid file change");
		}
		const path = string(change.path),
			diff = string(change.diff);
		paths.push(path);
		return { type: "unifiedDiff", path, diff };
	});
	return { paths, content };
}

// 推論・計画・MCP などの完了項目を、共通ツールカードへ正規化する。
import type { ToolSummary } from "@nerita/shared/chatState";
import { textToolContent, type ToolContent } from "@nerita/shared/toolContent";
import { isRecord } from "@nerita/shared/validation";

/** テキストを表示用のコンテンツ形式へ変換する。 */
export const textContent = textToolContent;
/** コマンドと編集以外の App Server 項目を表示用に変換する。 */
export function activityItem(
	value: Record<string, unknown>,
): Partial<ToolSummary> | null {
	const type = value.type;
	const matchesSome = [
		"userMessage",
		"agentMessage",
		"commandExecution",
		"fileChange",
		"hookPrompt",
		"subAgentActivity",
		"collabAgentToolCall",
	].some((itemType) => itemType === type);
	if (matchesSome) {
		return null;
	}
	const title = typeof value.tool === "string" ? value.tool : string(type);
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
	return externalActivity(value, base);
}

/** 外部ツールと検索の入出力をカードへ変換する。 */
function externalActivity(
	value: Record<string, unknown>,
	base: Partial<ToolSummary>,
): Partial<ToolSummary> {
	const type = value.type;
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
			searchLabel: webSearchLabel(value.query ?? value.action),
			rawInput: value.query ?? value.action,
			rawOutput: value.action,
		};
	}
	return otherActivity(value, base);
}

/** 画像・レビューなどの補助的な活動を表示する。 */
function otherActivity(
	value: Record<string, unknown>,
	base: Partial<ToolSummary>,
): Partial<ToolSummary> {
	const type = value.type;
	if (type === "autoApprovalReview") {
		return {
			title: "Guardian Review",
			kind: "think",
			rawOutput: { review: value.review, action: value.action },
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
		return { ...base, title: string(value.name), rawOutput: value.output };
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
/** 追加・削除の本文を変更前後へ振り分け、更新の unified diff はそのまま保持する。 */
export function fileChanges(changes: unknown): {
	paths: string[];
	content: ToolContent[];
} {
	if (!Array.isArray(changes)) {
		throw new Error("Invalid file changes");
	}
	const content = changes.map(fileChangeContent);
	return { paths: content.map((change) => change.path), content };
}

/** 変更種別に応じて本文とパッチを区別し、ファイル内容の文字列は加工しない。 */
function fileChangeContent(
	change: unknown,
): Extract<ToolContent, { type: "diff" | "unifiedDiff" }> {
	if (!isRecord(change)) {
		throw new Error("Invalid file change");
	}
	const path = string(change.path),
		diff = string(change.diff);
	// App Server は、追加・削除の `diff` にパッチではなくファイル本文を格納する。
	const kind = isRecord(change.kind) ? change.kind.type : undefined;
	if (kind === "add") {
		return { type: "diff", path, oldText: null, newText: diff };
	}
	if (kind === "delete") {
		return { type: "diff", path, oldText: diff, newText: "" };
	}
	return { type: "unifiedDiff", path, diff };
}

/** 検索語と URL の優先順位は Host で決め、バックエンドの `action` を UI に解釈させない。 */
function webSearchLabel(input: unknown): string {
	if (typeof input === "string") {
		return input;
	}
	if (!isRecord(input)) {
		return "";
	}
	if (typeof input.query === "string" && input.query.trim() !== "") {
		return input.query;
	}
	const action = isRecord(input.action) ? input.action : input;
	return typeof action.url === "string" ? action.url : "";
}

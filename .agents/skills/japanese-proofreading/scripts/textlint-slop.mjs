// 抽出済みの文章から、静的エラーと文脈確認が必要な表現を分けて検出する。
import { maskHtmlComments, maskProtectedText } from "./textlint-protected.mjs";

/** 既存の抽出・除外処理を通したレビュー項目を受け取り、自動置換せず診断を返す。 */
export function findSlopIssues(items, config) {
	const patterns = [
		...config.patterns.map((entry) => ({
			...entry,
			type: "ai-slop-pattern",
		})),
		...config.reviewPatterns.map((entry) => ({
			...entry,
			type: "ai-slop",
		})),
	].map((entry) => ({ ...entry, regex: new RegExp(entry.pattern, "gu") }));
	// 長い語を先に照合し、同じ位置の短い語を重ねて報告しない。
	const reviewTerms = [...config.reviewTerms].sort(
		(a, b) => b.length - a.length,
	);
	return items.flatMap((item) => findItemIssues(item, patterns, reviewTerms));
}

/** 保護領域を除き、抽出位置を元ファイルの行番号へ戻す。 */
function findItemIssues(item, patterns, reviewTerms) {
	const issues = [];
	const lines = item.text.split(/\r?\n/);
	const masked = maskProtectedText(maskHtmlComments(item.text), {
		preserveRealTarget: true,
	});
	for (const [index, line] of masked.split(/\r?\n/).entries()) {
		const report = (type, term, suggestion) =>
			issues.push({
				file: item.file,
				line: item.startLine + index,
				type,
				term,
				suggestion,
				text: lines[index].trim(),
			});
		for (const { regex, type, message } of patterns) {
			for (const match of line.matchAll(regex)) {
				report(type, match[0].trim(), message);
			}
		}
		let remaining = line;
		for (const term of reviewTerms) {
			remaining = remaining.replaceAll(term, () => {
				report(
					"ai-slop",
					term,
					"具体的な対象・状態を説明しているか確認してください。正当な用語は維持できます。",
				);
				return " ".repeat(term.length);
			});
		}
	}
	return issues;
}

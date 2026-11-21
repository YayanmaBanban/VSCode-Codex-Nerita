// 承認された補足を安定 ID で見つけ、媒体の初期閉パネルへ変換する。
import assert from "node:assert/strict";

export function validateDetailPlan(plan, sections) {
	assert.ok(Array.isArray(plan), "detailPlan は配列が必要です");
	const ids = new Set();
	for (const detail of plan) {
		assert.ok(sections.some((section) => section.id === detail.sectionId && section.foldedDetails.length), "補足を含む承認済みの章を指定してください");
		assert.match(detail.detailId, /^[a-z][a-z0-9-]*$/u, "補足の安定 ID が必要です");
		assert.ok(!ids.has(detail.detailId), "詳細 ID が重複しています");
		assert.equal(detail.initiallyCollapsed, true, "補足は初期閉にします");
		for (const value of [detail.kind, detail.title, detail.requiredSummary, detail.outputRef.zenn, detail.outputRef.qiita]) {
			assert.ok(typeof value === "string" && value.trim(), "補足の種類、タイトル、本文の要点、表示先が必要です");
			assert.doesNotMatch(value, /[\r\n]/u, "補足の表示情報は1行で指定してください");
		}
		ids.add(detail.detailId);
	}
	for (const section of sections.filter((item) => item.foldedDetails.length > 0)) {
		assert.ok(plan.some((detail) => detail.sectionId === section.id), `承認済みの補足に対応するパネルがありません: ${section.id}`);
	}
	for (const platform of ["zenn", "qiita"]) {
		assert.equal(new Set(plan.map((detail) => detail.outputRef[platform])).size, plan.length, "媒体内のパネルをタイトルで区別してください");
	}
}

function nextFence(line, current) {
	const match = line.match(/^ {0,3}(`{3,}(?!`)|~{3,}(?!~))/u);
	if (!match) {
		return current;
	}
	const [prefix, fence] = match;
	if (!current) {
		return fence;
	}
	if (fence[0] === current[0] && fence.length >= current.length && !line.slice(prefix.length).trim()) {
		return null;
	}
	return current;
}

function openDetail(detail, platform, colons) {
	const title = detail.outputRef[platform].replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	if (platform === "zenn") {
		return `${colons}details ${title}`;
	}
	return `<details><summary>${title}</summary>`;
}

// フェンス内の例はそのまま出力し、ネストした補足は内側から閉じる。
export function renderPlannedDetails(markdown, plan, platform) {
	assert.ok(["zenn", "qiita"].includes(platform), "媒体は zenn または qiita を指定してください");
	const remaining = new Map(plan.map((detail) => [detail.detailId, detail]));
	const stack = [];
	const output = [];
	let fence = null;
	for (const line of markdown.replaceAll("\r\n", "\n").split("\n")) {
		const prior = fence;
		fence = nextFence(line, prior);
		const marker = prior || fence ? null : line.match(/^<!-- (\/?)detail:([a-z][a-z0-9-]*) -->$/u);
		if (!marker) {
			output.push(line);
			continue;
		}
		const [, closing, id] = marker;
		if (closing) {
			const open = stack.pop();
			assert.equal(open?.id, id, `補足 ${id} の閉じる位置が不正です`);
			output.push("", open.close, "");
			continue;
		}
		const detail = remaining.get(id);
		assert.ok(detail, `未定義または重複した補足 ID: ${id}`);
		const colons = ":".repeat(3 + plan.length - stack.length - 1);
		output.push("", openDetail(detail, platform, colons), "");
		stack.push({ id, close: platform === "zenn" ? colons : "</details>" });
		remaining.delete(id);
	}
	assert.equal(stack.length, 0, "閉じていない補足があります");
	assert.equal(remaining.size, 0, `元原稿にない補足: ${[...remaining.keys()].join(", ")}`);
	return output.join("\n");
}

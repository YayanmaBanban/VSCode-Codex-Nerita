import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	clearTextlintCacheForScope,
	extractDocumentAuditItems,
	maskIgnoredDocument,
	writeTextlintIssues,
	writeTextlintReview,
} from "../scripts/textlint-audit.mjs";

test("ignores marked document lines while preserving review line numbers", () => {
	const source = [
		"# 方針",
		"前の説明。",
		"<!-- texlint-ignore-start -->",
		"canonical化",
		"owner を使う。",
		"<!-- texlint-ignore-end-->",
		"後の説明。",
	].join("\r\n");
	const masked = maskIgnoredDocument(source, "docs/policy.md");
	const items = extractDocumentAuditItems(masked, "docs/policy.md");

	assert.equal(masked.split("\r\n").length, source.split("\r\n").length);
	assert.equal(masked.includes("canonical"), false);
	assert.equal(masked.includes("owner"), false);
	assert.deepEqual(
		items.map(({ startLine, endLine, text }) => ({
			startLine,
			endLine,
			text,
		})),
		[
			{ startLine: 1, endLine: 2, text: "# 方針\n前の説明。" },
			{ startLine: 7, endLine: 7, text: "後の説明。" },
		],
	);
});

test("rejects an unclosed document ignore range", () => {
	assert.throws(
		() =>
			maskIgnoredDocument(
				"前の説明。\n<!-- texlint-ignore-start -->\n後の説明。",
				"docs/policy.md",
			),
		/unclosed texlint-ignore-start: docs\/policy.md:2/,
	);
});

test("writes only requested cache files and clears stale review data", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerita-textlint-"));

	try {
		const reviewPath = await writeTextlintReview({
			root,
			scope: "changed",
			items: [
				{
					file: "docs/a.md",
					startLine: 1,
					endLine: 1,
					kind: "document",
					text: "説明。",
				},
			],
		});
		const reviewText = await fs.readFile(reviewPath, "utf8");
		assert.equal(reviewText.trim().split("\n").length, 2);

		assert.equal(
			await writeTextlintIssues({ root, scope: "changed", issues: [] }),
			null,
		);

		await clearTextlintCacheForScope({ root, scope: "changed" });
		await assert.rejects(() => fs.stat(reviewPath), { code: "ENOENT" });
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

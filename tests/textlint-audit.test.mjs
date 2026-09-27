import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	clearTextlintCacheForScope,
	writeTextlintIssues,
	writeTextlintReview,
} from "../scripts/textlint-audit.mjs";

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

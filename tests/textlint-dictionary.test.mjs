import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	extractProjectTerms,
	loadExternalTechnicalTerms,
	parseCspellWordList,
} from "../scripts/textlint-dictionary.mjs";

test("parses plain CSpell source terms and ignores comments or complex lines", () => {
	const terms = parseCspellWordList(
		[
			"# comment",
			"pnpm",
			"BTN # Button",
			"SHA-256",
			"two words",
			"",
		].join("\n"),
	);

	assert.deepEqual([...terms], ["pnpm", "btn", "sha-256"]);
});

test("extracts packages, commands, and path segments from package.json", () => {
	const terms = extractProjectTerms({
		name: "nerita-codex",
		dependencies: {
			"@types/node": "1.0.0",
		},
		scripts: {
			check: "pnpm check && node scripts/check.mjs --out dist/result.json",
		},
	});

	for (const term of ["nerita", "codex", "types", "node", "pnpm", "scripts", "dist"]) {
		assert.equal(terms.has(term), true, term);
	}
});

test("caches a pinned external dictionary and reuses it without network", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerita-textlint-dict-"));
	const dictionaryConfig = {
		revision: "fixture-revision",
		files: ["dict-a.txt", "dict-b.txt"],
	};
	let fetchCount = 0;

	try {
		const first = await loadExternalTechnicalTerms({
			root,
			dictionaryConfig,
			fetchImpl: async (url) => {
				fetchCount += 1;
				return {
					ok: true,
					status: 200,
					statusText: "OK",
					text: async () =>
						url.endsWith("dict-a.txt") ? "exports\npnpm\n" : "Node\ndist\n",
				};
			},
		});

		assert.equal(first.source, "downloaded");
		assert.equal(first.terms.has("exports"), true);
		assert.equal(first.terms.has("node"), true);
		assert.equal(fetchCount, 2);

		const second = await loadExternalTechnicalTerms({
			root,
			dictionaryConfig,
			fetchImpl: async () => {
				throw new Error("network should not be used");
			},
		});

		assert.equal(second.source, "cache");
		assert.equal(second.terms.has("pnpm"), true);
		assert.equal(fetchCount, 2);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

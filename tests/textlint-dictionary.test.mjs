import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	extractProjectTerms,
	extractReferencedPackageTerms,
	extractSourceIdentifiers,
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

test("extracts package names only from package-shaped repository evidence", () => {
	const terms = extractReferencedPackageTerms([
		'manifest.name !== "pi-web-access";',
		'const root = "npm/node_modules/pi-subagents";',
		'`@anthropic-ai/sandbox-runtime` を使う。',
		'other-package 1.2.3 を確認する。',
		'request-level と no-op は一般のハイフン語として残す。',
	].join("\n"));

	for (const term of ["pi-web-access", "pi-subagents", "sandbox-runtime", "other-package"]) {
		assert.equal(terms.has(term), true, term);
	}
	assert.equal(terms.has("request-level"), false);
	assert.equal(terms.has("no-op"), false);
});


test("extracts only identifier-shaped names from the TypeScript syntax tree", () => {
	const identifiers = extractSourceIdentifiers(
		[
			"const agentDir = root;",
			"class AgentViewer {}",
			"const CODEX_HOME = env.CODEX_HOME;",
			"const client_version = 1;",
			"const simple = 1;",
			"class Plan {}",
			'const text = "fakeIdentifier";',
			"// commentIdentifier は拾わない",
		].join("\n"),
		"fixture.ts",
	);

	assert.deepEqual(
		[...identifiers].sort(),
		["AgentViewer", "CODEX_HOME", "agentDir", "client_version"].sort(),
	);
});

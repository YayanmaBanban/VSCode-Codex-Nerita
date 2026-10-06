import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTextlintIgnore } from "../scripts/textlint-ignore.mjs";

async function createWorkspace(t, files) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "nerita-ignore-"));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	for (const [file, content] of Object.entries(files)) {
		await fs.mkdir(path.dirname(path.join(root, file)), {
			recursive: true,
		});
		await fs.writeFile(path.join(root, file), content);
	}
	return root;
}

test("nested ignore patterns are relative to their folder and inherit parent rules", async (t) => {
	const root = await createWorkspace(t, {
		".textlintignore": "*.txt\n/root-only.md\n",
		"skill/.textlintignore": "/tests/\n/local.md\n*.generated.ts\n",
		"skill/nested/file.ts": "",
		"sibling/file.ts": "",
	});
	const matcher = createTextlintIgnore(root);
	for (const [file, expected] of [
		["root-only.md", true],
		["skill/root-only.md", false],
		["skill/nested/sample.txt", true],
		["skill/tests/", true],
		["skill/tests/sample.ts", true],
		["skill/nested/tests/", false],
		["skill/local.md", true],
		["skill/nested/local.md", false],
		["skill/nested/sample.generated.ts", true],
		["sibling/tests/", false],
		["sibling/sample.generated.ts", false],
	]) {
		assert.equal(await matcher.ignores(file), expected, file);
	}
});

test("deeper negations override file exclusions but cannot revive excluded folders", async (t) => {
	const root = await createWorkspace(t, {
		".textlintignore": "*.md\n/blocked/\n",
		"skill/.textlintignore": "!keep.md\n!nested/keep.md\n",
		"skill/nested/.textlintignore": "/keep.md\n!other.md\n",
		"blocked/.textlintignore": "!keep.md\n",
	});
	const matcher = createTextlintIgnore(root);
	for (const [file, expected] of [
		["skill/keep.md", false],
		["skill/hidden.md", true],
		["skill/nested/keep.md", true],
		["skill/nested/other.md", false],
		["blocked/keep.md", true],
	]) {
		assert.equal(await matcher.ignores(file), expected, file);
	}
});

test("mandatory exclusions and directory links cannot be re-included", async (t) => {
	const root = await createWorkspace(t, {
		".textlintignore": "!node_modules/\n!.git/\n!.textlint-cache/\n",
		"skill/.textlintignore": "!node_modules/\n!node_modules/**\n",
		"outside/.textlintignore": "*.md\n",
	});
	const matcher = createTextlintIgnore(root);
	for (const file of [
		"node_modules/sample.md",
		".git/config.md",
		".textlint-cache/sample.md",
		"skill/node_modules/sample.md",
	]) {
		assert.equal(await matcher.ignores(file), true, file);
	}
	await fs.symlink(
		path.join(root, "outside"),
		path.join(root, "link"),
		"junction",
	);
	assert.equal(await matcher.ignores("link/sample.md"), true);
	await assert.rejects(
		matcher.ignores("../outside.md"),
		/repository-relative/,
	);
});

// 技術辞書の保存先・再利用・更新と、プロジェクト語彙の分離を検証する。
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	loadAutomaticEnglishTerms,
	loadExternalTechnicalTerms,
} from "../scripts/textlint-dictionary.mjs";

/** 実際のスキルキャッシュに触れず、スキルとプロジェクトの保存先を再現する。 */
async function createWorkspace(t) {
	const directory = await fs.mkdtemp(
		path.join(os.tmpdir(), "nerita-dictionary-"),
	);
	t.after(() => fs.rm(directory, { recursive: true, force: true }));
	return {
		directory,
		cacheDirectory: path.join(directory, "skill", "config"),
	};
}

test("the skill cache is reused across projects without sharing package vocabulary", async (t) => {
	const { directory, cacheDirectory } = await createWorkspace(t);
	const dictionaryConfig = { revision: "first", files: ["words.txt"] };
	let downloads = 0;
	const fetchImpl = async () => {
		downloads += 1;
		return new Response("Sharedterm\n");
	};
	for (const [name, source] of [
		["firstpkg", "downloaded"],
		["secondpkg", "cache"],
	]) {
		const root = path.join(directory, name);
		await fs.mkdir(root);
		await fs.writeFile(
			path.join(root, "package.json"),
			JSON.stringify({ name }),
		);
		const result = await loadAutomaticEnglishTerms({
			root,
			cacheDirectory,
			dictionaryConfig,
			fetchImpl,
		});
		assert.equal(result.dictionarySource, source);
		assert(result.terms.has("sharedterm"));
		assert(result.terms.has(name));
		assert.equal(
			result.terms.has(name === "firstpkg" ? "secondpkg" : "firstpkg"),
			false,
		);
		await assert.rejects(
			fs.stat(path.join(root, ".textlint-cache", "technical-terms.json")),
			{ code: "ENOENT" },
		);
	}
	assert.equal(downloads, 1);
	const saved = JSON.parse(
		await fs.readFile(
			path.join(cacheDirectory, "technical-terms.json"),
			"utf8",
		),
	);
	assert.deepEqual(saved.terms, ["sharedterm"]);
});

test("revision or file changes replace the skill dictionary cache", async (t) => {
	const { cacheDirectory } = await createWorkspace(t);
	for (const dictionaryConfig of [
		{ revision: "first", files: ["words.txt"] },
		{ revision: "second", files: ["words.txt"] },
		{ revision: "second", files: ["other.txt"] },
	]) {
		const result = await loadExternalTechnicalTerms({
			cacheDirectory,
			dictionaryConfig,
			fetchImpl: async () => new Response(dictionaryConfig.revision),
		});
		assert.equal(result.source, "downloaded");
		assert.deepEqual([...result.terms], [dictionaryConfig.revision]);
		const saved = JSON.parse(
			await fs.readFile(
				path.join(cacheDirectory, "technical-terms.json"),
				"utf8",
			),
		);
		assert.equal(saved.revision, dictionaryConfig.revision);
		assert.deepEqual(saved.files, dictionaryConfig.files);
	}
});

test("a failed download leaves the cache absent and a later inspection retries", async (t) => {
	const { cacheDirectory } = await createWorkspace(t);
	const dictionaryConfig = { revision: "first", files: ["words.txt"] };
	const failed = await loadExternalTechnicalTerms({
		cacheDirectory,
		dictionaryConfig,
		fetchImpl: async () => {
			throw new Error("offline");
		},
	});
	assert.equal(failed.source, "unavailable");
	assert.equal(failed.terms.size, 0);
	await assert.rejects(
		fs.stat(path.join(cacheDirectory, "technical-terms.json")),
		{ code: "ENOENT" },
	);
	const retried = await loadExternalTechnicalTerms({
		cacheDirectory,
		dictionaryConfig,
		fetchImpl: async () => new Response("Recoveredterm\n"),
	});
	assert.equal(retried.source, "downloaded");
	assert(retried.terms.has("recoveredterm"));
});

import fs from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";

async function loadMatcher(directory) {
	const matcher = ignore();
	const file = path.join(directory, ".textlintignore");
	try {
		const stat = await fs.lstat(file);
		if (stat.isFile() && !stat.isSymbolicLink()) {
			matcher.add(await fs.readFile(file, "utf8"));
		}
	} catch (error) {
		if (error?.code !== "ENOENT") {
			throw error;
		}
	}
	return matcher;
}

/** 各設定の配置先からの相対パスで照合し、下位の設定を優先する。 */
function matchesScopes(scopes, file) {
	let ignored = false;
	for (const { directory, matcher } of scopes) {
		const relative = directory ? file.slice(directory.length + 1) : file;
		const result = matcher.test(relative);
		if (result.ignored || result.unignored) {
			ignored = result.ignored;
		}
	}
	return ignored;
}

/** リポジトリ内の `.textlintignore` を継承し、除外したフォルダやリンクを探索しない。 */
export function createTextlintIgnore(root) {
	const mandatory = ignore().add([
		".git/",
		"node_modules/",
		".textlint-cache/",
	]);
	const cache = new Map();

	async function loadScopes(directory) {
		const scopes = directory
			? await getScopes(path.posix.dirname(directory))
			: [];
		if (!scopes || (directory && matchesScopes(scopes, `${directory}/`))) {
			return null;
		}
		const absolute = path.join(root, directory);
		const stat = await fs.lstat(absolute);
		if (!stat.isDirectory() || stat.isSymbolicLink()) {
			return null;
		}
		return [...scopes, { directory, matcher: await loadMatcher(absolute) }];
	}

	function getScopes(directory) {
		const key = directory === "." ? "" : directory;
		if (!cache.has(key)) {
			cache.set(key, loadScopes(key));
		}
		return cache.get(key);
	}

	return {
		async ignores(file) {
			if (!ignore.isPathValid(file)) {
				throw new Error("Expected a repository-relative path");
			}
			if (mandatory.ignores(file)) {
				return true;
			}
			const scopes = await getScopes(
				path.posix.dirname(file.replace(/\/$/, "")),
			);
			return !scopes || matchesScopes(scopes, file);
		},
	};
}

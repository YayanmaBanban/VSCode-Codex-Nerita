import fs from "node:fs/promises";
import path from "node:path";

const CACHE_VERSION = 1;
const CACHE_FILE = "technical-terms.json";
const CSPELL_RAW_BASE =
	"https://raw.githubusercontent.com/streetsidesoftware/cspell-dicts";

function addTerm(terms, value) {
	if (typeof value !== "string") {
		return;
	}

	for (const match of value.matchAll(
		/[A-Z][A-Z0-9]*(?:[._+#:@-][A-Z0-9]+)*/gi,
	)) {
		const term = match[0].toLowerCase();
		terms.add(term);

		for (const part of term.split(/[._+#:@-]+/)) {
			if (part.length >= 2) {
				terms.add(part);
			}
		}
	}
}

function addPackageName(terms, packageName) {
	if (typeof packageName !== "string") {
		return;
	}

	for (const part of packageName.replace(/^@/, "").split("/")) {
		addTerm(terms, part);
	}
}

/**
 * ソースや文書内でパッケージ名として明示されている語を抽出する。
 *
 * `npm:`、`node_modules`、`manifest.name` / `metadata.name` から抽出する。
 * スコープ付きパッケージ名と、バージョン番号に隣接する名前も対象にする。
 * 単なるハイフンを含む語は対象にしない。
 */
export function extractReferencedPackageTerms(source) {
	const terms = new Set();
	const addMatches = (pattern, group = 1) => {
		for (const match of source.matchAll(pattern)) {
			addPackageName(terms, match[group]);
		}
	};

	addMatches(/npm:((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)/gi);
	addMatches(
		/node_modules[\\/]((?:@[a-z0-9][\w.-]*[\\/])?[a-z0-9][\w.-]*)/gi,
	);
	addMatches(
		/(?:manifest|metadata)\.name\s*(?:===|!==|==|!=)\s*["']([^"']+)["']/g,
	);
	addMatches(/(@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*)/gi);
	addMatches(
		/`?\b([a-z0-9][\w.]*-[\w\-.]+)\b`?\s+`?v?\d+\.\d+\.\d+\b`?/gi,
	);

	return terms;
}

/**
 * CSpell のソース辞書から、この lint で扱える単純な英数字語だけを取り出す。
 */
export function parseCspellWordList(source) {
	const terms = new Set();

	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine
			.replace(/^\uFEFF/, "")
			.replace(/\s+#.*$/, "")
			.trim();

		if (!line || line.startsWith("#")) {
			continue;
		}

		if (line.length >= 2 && /^[A-Z0-9][\w.+#:@-]*$/i.test(line)) {
			terms.add(line.toLowerCase());
		}
	}

	return terms;
}

/**
 * package.json から、このリポジトリで実際に使っているパッケージ名・コマンド・パス語彙を抽出する。
 */
export function extractProjectTerms(packageJson) {
	const terms = new Set();

	addPackageName(terms, packageJson.name);

	for (const dependencies of [
		packageJson.dependencies,
		packageJson.devDependencies,
		packageJson.optionalDependencies,
		packageJson.peerDependencies,
	]) {
		for (const packageName of Object.keys(dependencies ?? {})) {
			addPackageName(terms, packageName);
		}
	}

	for (const script of Object.values(packageJson.scripts ?? {})) {
		if (typeof script !== "string") {
			continue;
		}

		for (const match of script.matchAll(
			/(?:^|&&|\|\||;)\s*([A-Z][\w.-]*)/gi,
		)) {
			addTerm(terms, match[1]);
		}

		for (const match of script.matchAll(
			/[\w.-]+(?:[\\/][\w.-]+)+/g,
		)) {
			for (const segment of match[0].split(/[\\/]/)) {
				addTerm(terms, segment);
			}
		}
	}

	return terms;
}

function sameStringArray(left, right) {
	return (
		Array.isArray(left) &&
		Array.isArray(right) &&
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

async function readDictionaryCache(cachePath, dictionaryConfig) {
	try {
		const content = await fs.readFile(cachePath, "utf8");
		const cache = JSON.parse(content);

		if (
			cache.version !== CACHE_VERSION ||
			cache.revision !== dictionaryConfig.revision ||
			!sameStringArray(cache.files, dictionaryConfig.files) ||
			!Array.isArray(cache.terms)
		) {
			return null;
		}

		return new Set(cache.terms);
	} catch (error) {
		if (error?.code === "ENOENT" || error instanceof SyntaxError) {
			return null;
		}

		throw error;
	}
}

async function downloadDictionary(dictionaryConfig, fetchImpl) {
	const responses = await Promise.all(
		dictionaryConfig.files.map(async (file) => {
			const url = `${CSPELL_RAW_BASE}/${dictionaryConfig.revision}/${file}`;
			const response = await fetchImpl(url, {
				signal: AbortSignal.timeout(5000),
			});

			if (!response.ok) {
				throw new Error(
					`${response.status} ${response.statusText}: ${file}`,
				);
			}

			return response.text();
		}),
	);

	const terms = new Set();

	for (const source of responses) {
		for (const term of parseCspellWordList(source)) {
			terms.add(term);
		}
	}

	return terms;
}

/** 技術辞書の取得に必要な設定が揃っているかを判定する。 */
function isDictionaryConfigured(dictionaryConfig) {
	return (
		Boolean(dictionaryConfig?.revision) &&
		Array.isArray(dictionaryConfig.files) &&
		dictionaryConfig.files.length > 0
	);
}

/**
 * リビジョンを固定した CSpell の技術辞書を読み込み、取得結果をキャッシュに保存する。
 *
 * 取得できない場合は検査を止めず、空の語彙を返す。
 */
export async function loadExternalTechnicalTerms({
	root,
	dictionaryConfig,
	fetchImpl = globalThis.fetch,
}) {
	if (!isDictionaryConfigured(dictionaryConfig)) {
		return { terms: new Set(), source: "disabled", warning: null };
	}

	const cacheDirectory = path.join(root, ".textlint-cache");
	const cachePath = path.join(cacheDirectory, CACHE_FILE);
	const cached = await readDictionaryCache(cachePath, dictionaryConfig);

	if (cached) {
		return { terms: cached, source: "cache", warning: null };
	}

	if (typeof fetchImpl !== "function") {
		return {
			terms: new Set(),
			source: "unavailable",
			warning: "CSpell 技術辞書を取得する fetch が利用できません。",
		};
	}

	try {
		const terms = await downloadDictionary(dictionaryConfig, fetchImpl);

		await fs.mkdir(cacheDirectory, { recursive: true });
		await fs.writeFile(
			cachePath,
			JSON.stringify({
				version: CACHE_VERSION,
				revision: dictionaryConfig.revision,
				files: dictionaryConfig.files,
				terms: [...terms].sort(),
			}),
			"utf8",
		);

		return { terms, source: "downloaded", warning: null };
	} catch (error) {
		return {
			terms: new Set(),
			source: "unavailable",
			warning: `CSpell 技術辞書を取得できませんでした: ${error?.message ?? error}`,
		};
	}
}

/**
 * 外部技術辞書と package.json 由来の語彙を結合する。
 */
export async function loadAutomaticEnglishTerms({
	root,
	dictionaryConfig,
	fetchImpl = globalThis.fetch,
}) {
	let packageJson = {};
	try {
		packageJson = JSON.parse(
			await fs.readFile(path.join(root, "package.json"), "utf8"),
		);
	} catch (error) {
		// package.json がない場合は、依存パッケージ由来の語彙を追加しない。
		if (error?.code !== "ENOENT") {
			throw error;
		}
	}
	const projectTerms = extractProjectTerms(packageJson);
	const external = await loadExternalTechnicalTerms({
		root,
		dictionaryConfig,
		fetchImpl,
	});
	const terms = new Set([...projectTerms, ...external.terms]);

	return {
		terms,
		dictionarySource: external.source,
		warning: external.warning,
	};
}

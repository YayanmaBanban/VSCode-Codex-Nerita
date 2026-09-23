// Piの固定依存・配布ライセンス・bundle対象ソースの指紋を更新する。
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { runPnpm } = require("./run-pnpm.cjs");
const { cleanupLicenses } = require("./cleanup-licenses.cjs");

/** JSONをrequireキャッシュに依存せず読み込む。 */
async function readJson(file) {
	return JSON.parse(await fs.readFile(file, "utf8"));
}

/** 全入力を確認してから、バージョン・ライセンス・指紋を書き出す。 */
async function main() {
	const requested = readRequestedVersion();
	const root = path.resolve(__dirname, "..");
	if (requested !== undefined) {
		runPnpm([
			"add",
			"--save-exact",
			`@earendil-works/pi-coding-agent@${requested}`,
		]);
	}
	const sdk = await fs.realpath(
		path.join(root, "node_modules/@earendil-works/pi-coding-agent"),
	);
	const ai = await fs.realpath(path.join(sdk, "../pi-ai"));
	const { version } = await readJson(path.join(sdk, "package.json"));
	const aiManifest = await readJson(path.join(ai, "package.json"));
	const project = await readJson(path.join(root, "package.json"));
	if (
		project.dependencies["@earendil-works/pi-coding-agent"] !== version ||
		aiManifest.version !== version ||
		(requested !== undefined && requested !== version)
	) {
		throw new Error(
			"指定版・固定依存・インストール済みPi SDK・pi-aiのバージョンを揃えてください。",
		);
	}
	const contractPath = path.join(__dirname, "pi-sdk-contract.json");
	const contract = await readSdkContract(contractPath, sdk, ai);
	const url = `https://raw.githubusercontent.com/earendil-works/pi/v${version}/LICENSE`;
	const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
	if (!response.ok) {
		throw new Error(
			`Pi LICENSEの取得に失敗しました: HTTP ${response.status} (${url})`,
		);
	}
	const license = Buffer.from(await response.arrayBuffer());
	if (license.length === 0) {
		throw new Error(`Pi LICENSEが空です: ${url}`);
	}
	const directory = path.join(__dirname, "licenses", `pi-${version}`);
	await fs.mkdir(directory, { recursive: true });
	await fs.writeFile(path.join(directory, "LICENSE"), license);
	await fs.writeFile(
		contractPath,
		`${JSON.stringify(contract, null, "\t")}\n`,
	);
	await fs.writeFile(
		path.join(__dirname, "pi-version.json"),
		`${JSON.stringify({ version }, null, "\t")}\n`,
	);
	await cleanupLicenses(path.join(__dirname, "licenses"), "pi", version);
	console.log(
		`Pi ${version} の更新資産を生成しました。差分と互換処理を確認し、pnpm pi:verify を実行してください。`,
	);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

/** 生成コマンドのバージョン引数を検証する。 */
function readRequestedVersion() {
	const args = process.argv.slice(2);
	const requested = args[0];
	if (
		args.length > 1 ||
		(requested !== undefined &&
			!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(requested))
	) {
		throw new Error("使い方: pnpm pi:generate [バージョン（例: 0.86.1）]");
	}
	return requested;
}

/** SDKの互換性確認対象ファイルの指紋を生成する。 */
async function readSdkContract(contractPath, sdk, ai) {
	const previous = await readJson(contractPath);
	const contract = {};
	const roots = { sdk, ai };
	for (const [name, files] of Object.entries(previous)) {
		contract[name] = {};
		for (const [file, expected] of Object.entries(files)) {
			const content = await fs.readFile(path.join(roots[name], file));
			const actual = createHash("sha256").update(content).digest("hex");
			contract[name][file] = actual;
			if (actual !== expected) {
				console.log(
					`互換性確認対象: ${name}/${file} (${expected} -> ${actual})`,
				);
			}
		}
	}
	return contract;
}

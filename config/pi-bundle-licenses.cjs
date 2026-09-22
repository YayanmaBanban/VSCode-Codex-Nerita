// bundleへ入った依存だけのライセンス・出典を収集し、丸ごとコピー廃止後も表記を保持する。
const fs = require("node:fs/promises");
const path = require("node:path");

/** nested package境界から、名前を持つ配布パッケージまで遡る。 */
async function packageRoot(file) {
	let directory = path.dirname(file);
	while (directory !== path.dirname(directory)) {
		try {
			const manifest = JSON.parse(
				await fs.readFile(path.join(directory, "package.json"), "utf8"),
			);
			if (manifest.name) {
				return { directory, manifest };
			}
		} catch (error) {
			if (error.code !== "ENOENT") {
				throw error;
			}
		}
		directory = path.dirname(directory);
	}
	throw new Error(`依存パッケージの出典が見つかりません: ${file}`);
}

/** esbuildが実際に出力した入力だけを対象にする。 */
async function copyBundleLicenses(
	projectRoot,
	destination,
	metadata,
	photonRoot,
) {
	const roots = new Map();
	const inputs = new Set(
		Object.values(metadata.outputs).flatMap((output) =>
			Object.keys(output.inputs),
		),
	);
	inputs.add(path.join(photonRoot, "photon_rs.js"));
	for (const file of inputs) {
		if (!file.includes("node_modules")) {
			continue;
		}
		const result = await packageRoot(path.resolve(projectRoot, file));
		roots.set(result.directory, result.manifest);
	}
	const notices = [];
	for (const [directory, manifest] of roots) {
		const name = `${manifest.name.replaceAll("/", "__")}@${manifest.version}`;
		const output = path.join(destination, "licenses", name);
		await fs.mkdir(output, { recursive: true });
		const files = (await fs.readdir(directory)).filter((file) =>
			/^(licen[sc]e|notice|copying)([.-]|$)/i.test(file),
		);
		for (const file of files) {
			await fs.cp(path.join(directory, file), path.join(output, file), {
				recursive: true,
			});
		}
		if (manifest.name.startsWith("@earendil-works/")) {
			await fs.copyFile(
				path.join(
					__dirname,
					"licenses",
					`pi-${manifest.version}`,
					"LICENSE",
				),
				path.join(output, "LICENSE"),
			);
		} else if (!files.length) {
			// npmがlicenseを省略した依存は、固定版に対応する上流表記を保持する。
			await fs.copyFile(
				path.join(__dirname, "licenses", name, "LICENSE"),
				path.join(output, "LICENSE"),
			);
		}
		notices.push({
			name: manifest.name,
			version: manifest.version,
			license: manifest.license,
			repository: manifest.repository,
		});
	}
	await fs.writeFile(
		path.join(destination, "licenses", "packages.json"),
		JSON.stringify(notices, null, 2),
	);
}
module.exports = { copyBundleLicenses };

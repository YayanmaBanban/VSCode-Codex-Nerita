// `node tests/scratch/workspace-symbol-probe.cjs` で専用 VS Code の言語プロバイダーと製品検索を比較する。
const fs = require("node:fs/promises");
const path = require("node:path");
const { build } = require("esbuild");
const { runTests } = require("@vscode/test-electron");

/** 利用者のプロファイルを変更せず、未表示の TypeScript ファイルの検索を検証する。 */
async function main() {
	const root = path.resolve("dist/ui-review", `symbol-probe-${Date.now()}`);
	if (process.argv.includes("--ui")) {
		await captureSearch(root);
		return;
	}
	const workspace = process.argv.includes("--repository")
		? path.resolve(".")
		: path.join(root, "workspace");
	const extension = path.join(root, "extension");
	await fs.mkdir(workspace, { recursive: true });
	await fs.mkdir(extension, { recursive: true });
	await fs.writeFile(
		path.join(extension, "package.json"),
		JSON.stringify({
			name: "symbol-probe",
			publisher: "local",
			version: "0.0.1",
			engines: { vscode: "^1.137.0" },
		}),
	);
	if (!process.argv.includes("--repository")) {
		await fs.writeFile(
			path.join(workspace, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: { target: "ES2022" },
				include: ["*.ts"],
			}),
		);
		await fs.writeFile(
			path.join(workspace, "example.ts"),
			"export class WorkspaceSymbolProbe { run() { return 1; } }\n",
		);
	}
	await build({
		entryPoints: ["tests/scratch/workspace-symbol-probe.ts"],
		outfile: path.join(root, "probe.cjs"),
		bundle: true,
		platform: "node",
		format: "cjs",
		external: ["vscode"],
		conditions: ["nerita-source"],
	});
	await runTests({
		vscodeExecutablePath: path.resolve(
			".vscode-test/vscode-win32-x64-archive-1.143.1/Code.exe",
		),
		extensionDevelopmentPath: extension,
		extensionTestsPath: path.join(root, "probe.cjs"),
		launchArgs: [
			workspace,
			"--user-data-dir",
			path.join(root, "profile"),
			"--extensions-dir",
			path.join(root, "extensions"),
			"--skip-welcome",
			"--skip-release-notes",
			"--disable-workspace-trust",
		],
		extensionTestsEnv: {
			NERITA_SYMBOL_REPORT: path.join(root, "report.json"),
			NERITA_SYMBOL_REPOSITORY: String(
				process.argv.includes("--repository"),
			),
		},
	});
	console.log(await fs.readFile(path.join(root, "report.json"), "utf8"));
	console.log(root);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

/** `--ui` では起動済み Storybook の検索結果と失敗状態を、明暗・狭幅で撮影する。 */
async function captureSearch(root) {
	const { chromium, expect } = require("@playwright/test");
	await fs.mkdir(root, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const errors = [];
	const rotations = [];
	try {
		for (const theme of ["dark2026", "light"]) {
			const page = await browser.newPage({
				viewport: { width: 420, height: 900 },
			});
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") {
					errors.push(message.text());
				}
			});
			for (const story of [
				"search",
				"search-request-failure",
				"loading",
			]) {
				await captureSymbolStory({
					page,
					root,
					theme,
					story,
					rotations,
					expect,
				});
			}
			await page.close();
		}
		await fs.writeFile(
			path.join(root, "errors.json"),
			JSON.stringify(errors, null, 2),
		);
		await fs.writeFile(
			path.join(root, "rotations.json"),
			JSON.stringify(rotations, null, 2),
		);
		expect(errors).toEqual([]);
		console.log(root);
	} finally {
		await browser.close();
	}
}

/** 1つの検索状態を検証し、テーマ別のスクリーンショットを保存する。 */
async function captureSymbolStory({
	page,
	root,
	theme,
	story,
	rotations,
	expect,
}) {
	await page.goto(
		`http://localhost:6007/iframe.html?id=chat-composer-symbols--${story}&viewMode=story&globals=theme:${theme}`,
	);
	const list = page.getByRole("listbox", { name: "シンボル" });
	const expected = {
		search: "UserService",
		"search-request-failure": "Host search failed",
		loading: "検索中",
	};
	await expect(list).toContainText(expected[story]);
	if (story === "loading") {
		const frames = await verifySpinner(page, list, expect);
		rotations.push({ theme, ...frames });
	}
	await page.screenshot({ path: path.join(root, `${theme}-${story}.png`) });
}

/** 回転の進行と OS の動きを減らす設定への追従を確認する。 */
async function verifySpinner(page, list, expect) {
	const spinner = list.locator("svg");
	await expect(spinner).toHaveCSS("animation-name", "spin");
	const frames = await spinner.evaluate((element) => {
		const animation = element.getAnimations()[0];
		animation.pause();
		animation.currentTime = 0;
		const initial =
			element.ownerDocument.defaultView.getComputedStyle(
				element,
			).transform;
		animation.currentTime = 250;
		const quarter =
			element.ownerDocument.defaultView.getComputedStyle(
				element,
			).transform;
		animation.play();
		return { initial, quarter };
	});
	expect(frames.initial).not.toBe(frames.quarter);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect(spinner).toHaveCSS("animation-name", "none");
	await page.emulateMedia({ reducedMotion: "no-preference" });
	return frames;
}

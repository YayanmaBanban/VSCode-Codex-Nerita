// 実 SDK で導入済みのリソースを解決し、未導入パッケージを取得せず設定を保持する。
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as sdk from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { sandboxFixture } from "../unit/sandboxFixtures";
import { localResourceSettings } from "../../apps/vscode-nerita/src/extension/backends/pi/PiResourceSettings";

it("導入済みの npm パッケージだけを使い、スコープ・フィルター・元の設定を保持する", async () => {
	const files = await sandboxFixture();
	const global = {
		packages: ["npm:installed", "npm:missing"],
		theme: "dark",
	};
	const project = {
		packages: [{ source: "npm:installed", skills: ["skills/**"] }],
	};
	const globalFile = join(files.outside, "settings.json");
	const projectFile = join(files.cwd, ".pi/settings.json");
	try {
		await mkdir(join(files.cwd, ".pi"));
		await writeFile(globalFile, JSON.stringify(global));
		await writeFile(projectFile, JSON.stringify(project));
		const userPackage = join(files.outside, "npm/node_modules/installed");
		const projectPackage = join(
			files.cwd,
			".pi/npm/node_modules/installed",
		);
		await mkdir(userPackage, { recursive: true });
		await mkdir(projectPackage, { recursive: true });
		const original = sdk.SettingsManager.create(files.cwd, files.outside, {
			projectTrusted: true,
		});
		const resolved = await localResourceSettings(
			sdk,
			files.cwd,
			files.outside,
			original,
		);
		expect(resolved.getGlobalSettings()).toEqual({
			packages: [await realpath(userPackage)],
			theme: "dark",
		});
		expect(resolved.getProjectSettings()).toEqual({
			packages: [
				{
					source: await realpath(projectPackage),
					skills: ["skills/**"],
				},
			],
		});
		expect(resolved.isProjectTrusted()).toBe(true);
		expect(original.getGlobalSettings()).toEqual(global);
		expect(original.getProjectSettings()).toEqual(project);
		expect(JSON.parse(await readFile(globalFile, "utf8"))).toEqual(global);
		expect(JSON.parse(await readFile(projectFile, "utf8"))).toEqual(
			project,
		);
	} finally {
		await files.cleanup();
	}
});

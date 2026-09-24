// 未導入パッケージのHost実行を避け、既存リソースだけがloaderへ渡ることを検証する。
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { localResourceSettings } from "../../src/extension/backends/pi/PiResourceSettings";

it("導入済みだけを実体パスへ変換し、元の設定とresource filterを維持する", async () => {
	const directory = await realpath(
		await mkdtemp(join(tmpdir(), "nerita-resources-")),
	);
	try {
		const global = {
			packages: ["npm:installed", "npm:missing", "git:deleted"],
			theme: "dark",
		};
		const project = {
			packages: [{ source: "npm:installed", skills: ["skills/**"] }],
		};
		const getInstalledPath = vi.fn((source: string) => {
			if (source === "npm:installed") {
				return directory;
			}
			return source === "git:deleted"
				? join(directory, "deleted")
				: undefined;
		});
		const snapshots: Record<string, unknown> = {};
		const sdk = {
			DefaultPackageManager: class {
				getInstalledPath = getInstalledPath;
			},
			SettingsManager: {
				fromStorage(
					storage: Parameters<
						typeof PiSdk.SettingsManager.fromStorage
					>[0],
					options: unknown,
				) {
					for (const scope of ["global", "project"] as const) {
						storage.withLock(scope, (json) => {
							snapshots[scope] = JSON.parse(json!);
							return undefined;
						});
					}
					expect(options).toEqual({ projectTrusted: true });
					return snapshots;
				},
			},
		} as unknown as typeof PiSdk;
		const settings = {
			getGlobalSettings: () => global,
			getProjectSettings: () => project,
			isProjectTrusted: () => true,
		} as unknown as PiSdk.SettingsManager;
		await localResourceSettings(sdk, directory, directory, settings);
		expect(snapshots.global).toEqual({
			packages: [directory],
			theme: "dark",
		});
		expect(snapshots.project).toEqual({
			packages: [{ source: directory, skills: ["skills/**"] }],
		});
		expect(global.packages).toEqual([
			"npm:installed",
			"npm:missing",
			"git:deleted",
		]);
		expect(getInstalledPath).toHaveBeenCalledWith(
			"npm:installed",
			"project",
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

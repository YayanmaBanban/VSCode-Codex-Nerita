// リソース探索が Host で未導入パッケージをインストールしないよう、導入済みのローカル参照だけを渡す。
import { realpath } from "node:fs/promises";
import type * as PiSdk from "@earendil-works/pi-coding-agent";

/** SDK の公開 SettingsManager から設定型を導出する。 */
type ResourceSettings = ReturnType<PiSdk.SettingsManager["getGlobalSettings"]>;

/** CLI による明示的な導入と、会話開始時のリソース読み込みを分離する。 */
export async function localResourceSettings(
	sdk: typeof PiSdk,
	cwd: string,
	agentDir: string,
	settings: PiSdk.SettingsManager,
): Promise<PiSdk.SettingsManager> {
	const manager = new sdk.DefaultPackageManager({
		cwd,
		agentDir,
		settingsManager: settings,
	});
	const global = await localPackages(
		settings.getGlobalSettings(),
		"user",
		manager,
	);
	const project = await localPackages(
		settings.getProjectSettings(),
		"project",
		manager,
	);
	return sdk.SettingsManager.fromStorage(
		{
			withLock(scope, read) {
				read(JSON.stringify(scope === "global" ? global : project));
			},
		},
		{ projectTrusted: settings.isProjectTrusted() },
	);
}

/** `npm/git` の指定も、存在を確認した実体パスへ置換して自動取得を防ぐ。 */
async function localPackages(
	settings: ResourceSettings,
	scope: "user" | "project",
	manager: PiSdk.DefaultPackageManager,
): Promise<ResourceSettings> {
	const packages: NonNullable<ResourceSettings["packages"]> = [];
	for (const entry of settings.packages ?? []) {
		const source = typeof entry === "string" ? entry : entry.source;
		const installed = manager.getInstalledPath(source, scope);
		if (!installed) {
			continue;
		}
		try {
			const local = await realpath(installed);
			packages.push(
				typeof entry === "string" ? local : { ...entry, source: local },
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
		}
	}
	return { ...settings, packages };
}

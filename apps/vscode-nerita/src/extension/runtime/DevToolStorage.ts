// ワークスペース別の永続キャッシュと呼出し別の設定を用意し、ホストの資格情報を公開しない。
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type { DevToolPolicy } from "./DevToolPolicy";
import { toolResource } from "./DevToolDiscovery";
import { sanitizedNpmConfig } from "./DevToolConfig";

/** `managedRoot` は Host 組み立て側だけが決める。キャッシュはワークスペースごとに分離して永続化する。 */
export async function prepareDevToolStorage(
	policy: DevToolPolicy,
	managedRoot: string,
	workspace: string,
	temporary: string,
	npmConfigSource?: string,
	persistentCache = true,
): Promise<DevToolPolicy> {
	await mkdir(managedRoot, { recursive: true });
	const root = await realpath(managedRoot);
	const workspaceId = createHash("sha256")
		.update(workspace.toLowerCase())
		.digest("hex");
	const cache = persistentCache
		? await managedDirectory(root, workspaceId)
		: await managedDirectory(temporary, "cache");
	const home = await managedDirectory(temporary, "home");
	const npmConfig = join(home, ".npmrc");
	const gitConfig = join(home, ".gitconfig");
	// ホストの .npmrc/.gitconfig は include・helper・秘密情報を持ち得るため、そのまま複製しない。
	await writeFile(
		npmConfig,
		npmConfigSource ? await sanitizedNpmConfig(npmConfigSource) : "",
		{ flag: "wx" },
	);
	await writeFile(gitConfig, "[credential]\n\thelper =\n", { flag: "wx" });
	const resources = [
		...policy.resources,
		{
			...toolResource("cache", cache, "development", "profile"),
			access: "readwrite" as const,
			scope: persistentCache
				? ("workspace" as const)
				: ("process" as const),
		},
		{
			...toolResource("config", npmConfig, "pnpm", "profile"),
			access: "read" as const,
		},
		{
			...toolResource("config", gitConfig, "git", "profile"),
			access: "read" as const,
		},
	];
	const environment = {
		...policy.environment,
		HOME: home,
		USERPROFILE: home,
		APPDATA: home,
		LOCALAPPDATA: home,
		XDG_CONFIG_HOME: home,
		XDG_CACHE_HOME: cache,
		NPM_CONFIG_USERCONFIG: npmConfig,
		NPM_CONFIG_GLOBALCONFIG: npmConfig,
		NPM_CONFIG_CACHE: cache,
		npm_config_store_dir: join(cache, "pnpm-store"),
		GIT_CONFIG_GLOBAL: gitConfig,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_TERMINAL_PROMPT: "0",
		TEMP: temporary,
		TMP: temporary,
	};
	resources.push(
		...Object.keys(environment).map((key) =>
			toolResource("environment", key, "development", "profile"),
		),
	);
	// 値を通知しない識別用リソース。実際の注入には別途 Host のブローカーが必要。
	resources.push(
		toolResource(
			"credential",
			"host-credentials",
			"development",
			"profile",
		),
	);
	return { ...policy, resources, environment };
}

/** 永続領域がリンクで置き換わっていた場合は別ディレクトリへ許可を移さない。 */
async function managedDirectory(root: string, name: string): Promise<string> {
	const directory = resolve(root, name);
	await mkdir(directory, { recursive: true });
	if ((await realpath(directory)) !== directory) {
		throw new Error("Sandbox 管理領域のパスが変更されています。");
	}
	return directory;
}

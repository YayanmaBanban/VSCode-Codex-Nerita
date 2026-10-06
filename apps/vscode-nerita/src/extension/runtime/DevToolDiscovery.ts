// PATH と実体パスから実行候補を検出する。プロファイル適用前に広い親ディレクトリを許可しない。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { realpath, stat } from "node:fs/promises";
import {
	basename,
	delimiter,
	dirname,
	isAbsolute,
	join,
	parse,
} from "node:path";
import { createHash } from "node:crypto";
import type {
	ResourceKind,
	ResourcePolicy,
} from "@nerita/shared/sandboxPolicy";
import type { DevToolPolicy, DevToolProfile } from "./DevToolPolicy";
import { containsPath } from "../security/AgentAccessPolicy";

/** 大文字小文字の重複を除き、OS 起動に必要な値だけを採用する。 */
export function devToolEnvironment(
	input: Record<string, string | null | undefined>,
): Record<string, string> {
	const output: Record<string, string> = {};
	for (const [key, value] of Object.entries(input)) {
		if (
			isNonEmptyString(value) &&
			/^(?:systemroot|windir|systemdrive|comspec|pathext|os|processor_architecture|number_of_processors)$/i.test(
				key,
			)
		) {
			output[key.toUpperCase()] = value;
		}
	}
	return output;
}

/** ID は設定値や資格情報の内容を持たず、パスと分類だけを識別する。 */
export function toolResource(
	kind: ResourceKind,
	target: string,
	tool: string,
	source: ResourcePolicy["source"] = "generic",
): ResourcePolicy {
	return {
		id: createHash("sha256")
			.update(`${kind}:${target.toLowerCase()}`)
			.digest("hex"),
		kind,
		target,
		tool,
		source,
		access: ["install", "helper"].includes(kind) ? "read" : "deny",
		scope: "process",
	};
}

/** PATH の相対項目を無視し、リンクは実体へ解決する。存在しない候補は権限にならない。 */
export async function discoverDevTools(
	input: Record<string, string | null | undefined>,
	profiles: readonly DevToolProfile[],
	command?: string,
): Promise<DevToolPolicy> {
	const directories = toolDirectories(input);
	const executables: Record<string, string> = {};
	const resources: ResourcePolicy[] = [];
	const names = [
		...new Set(profiles.flatMap((profile) => [...profile.commands])),
	];
	if (isNonEmptyString(command)) {
		names.push(command);
	}
	for (const name of names) {
		const candidates = isAbsolute(name)
			? [name]
			: directories.map((directory) => join(directory, name));
		for (const candidate of candidates) {
			const executable = await existingFile(candidate);
			if (!isNonEmptyString(executable)) {
				continue;
			}
			executables[basename(name).toLowerCase()] = executable;
			resources.push(toolResource("install", executable, basename(name)));
			break;
		}
	}
	// プロファイルには解決済み実体だけを渡し、PATH 文字列を権限として使わない。
	for (const profile of profiles) {
		for (const name of profile.commands) {
			const executable = executables[basename(name).toLowerCase()];
			if (isNonEmptyString(executable)) {
				resources.push(...(await profile.resolve(executable)));
			}
		}
	}
	const environment = devToolEnvironment(input);
	environment.PATH = [
		...new Set([
			...resources
				.filter(
					(resource) =>
						resource.kind === "helper" &&
						/\.(?:exe|cjs)$/i.test(resource.target),
				)
				.map((resource) => dirname(resource.target)),
			...Object.values(executables).map(dirname),
		]),
	].join(delimiter);
	return {
		resources: [
			...new Map(
				resources.map((resource) => [resource.id, resource]),
			).values(),
		],
		environment,
		executables,
	};
}

/** 環境変数は検出の手がかりに留め、ディレクトリをそのまま権限へ変換しない。 */
function toolDirectories(
	input: Record<string, string | null | undefined>,
): string[] {
	const environment = Object.fromEntries(
		Object.entries(input).map(([key, value]) => [key.toUpperCase(), value]),
	);
	const directories = (environment.PATH ?? "").split(delimiter);
	for (const name of [
		"NVM_SYMLINK",
		"PNPM_HOME",
		"JAVA_HOME",
		"DOTNET_ROOT",
		"VCINSTALLDIR",
	]) {
		const directory = environment[name];
		if (isNonEmptyString(directory) && isAbsolute(directory)) {
			directories.push(directory, join(directory, "bin"));
		}
	}
	return [...new Set(directories.filter(isAbsolute))];
}

/** ファイル以外や到達不能な候補を実行対象にしない。 */
async function existingFile(candidate: string): Promise<string | undefined> {
	try {
		const resolved = await realpath(candidate);
		return (await stat(resolved)).isFile() ? resolved : undefined;
	} catch {
		return undefined;
	}
}

/** ドライブ全体の読取りは、ツールを見つけた理由だけでは許可しない。 */
export function requireInstallDirectory(directory: string): string {
	const privateRoots = [
		process.env.USERPROFILE,
		process.env.APPDATA,
		process.env.LOCALAPPDATA,
	];
	if (
		parse(directory).root.toLowerCase() === directory.toLowerCase() ||
		privateRoots.some(
			(root) => isNonEmptyString(root) && containsPath(directory, root),
		)
	) {
		throw new Error(
			"ツールのインストール先としてドライブ全体や利用者の設定領域は許可できません。",
		);
	}
	return directory;
}

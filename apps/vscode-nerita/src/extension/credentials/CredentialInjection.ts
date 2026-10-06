// 実行ごとに取得した資格情報を専用の環境・設定へまとめ、終了時に一時領域と値を破棄する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { mkdtemp, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import type { ContainerConfig } from "@microsoft/mxc-sdk";
import type { CredentialBinding } from "@nerita/shared/credentials";
import type { CredentialLease } from "./CredentialBroker";
import { providerExecutable } from "./ProviderProcess";
import { sanitizedNpmConfig } from "../runtime/DevToolConfig";

/** Executor だけが読む追加環境と、MXC が実行中だけ公開する一時領域。 */
export type CredentialInjection = {
	env: Record<string, string>;
	directory: string;
	signal: AbortSignal;
	dispose(): Promise<void>;
};
export type CredentialInjectionEntry = {
	lease: CredentialLease;
	binding: CredentialBinding;
};

/** Host の npm 実行にも生の user npmrc を暗黙に継承させない。 */
export async function prepareCredentialInjection(
	entries: CredentialInjectionEntry[],
	signal: AbortSignal,
): Promise<CredentialInjection> {
	const directory = await mkdtemp(join(tmpdir(), "nerita-credential-"));
	const env: Record<string, string> = {};
	const config = join(directory, ".npmrc");
	try {
		await writeFile(
			config,
			await sanitizedNpmConfig(join(homedir(), ".npmrc")),
			{ flag: "wx", mode: 0o600 },
		);
		env.NPM_CONFIG_USERCONFIG = config;
		Object.assign(env, {
			GIT_TERMINAL_PROMPT: "0",
			GIT_CONFIG_COUNT: "1",
			GIT_CONFIG_KEY_0: "credential.helper",
			GIT_CONFIG_VALUE_0: "",
		});
		for (const entry of entries) {
			await applyEntry(entry, directory, env, config);
		}
		const combined = AbortSignal.any([
			signal,
			...entries.map((entry) => entry.lease.signal),
		]);
		combined.throwIfAborted();
		return {
			env,
			directory,
			signal: combined,
			async dispose() {
				for (const key of Object.keys(env)) {
					delete env[key];
				}
				entries.forEach((entry) => entry.lease.dispose());
				await rm(directory, { recursive: true, force: true });
			},
		};
	} catch (error) {
		entries.forEach((entry) => entry.lease.dispose());
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
}

/** npm のスコープを維持し、設定ファイルへの改行・補間の注入を拒否する。 */
async function applyEntry(
	{ lease, binding }: CredentialInjectionEntry,
	directory: string,
	env: Record<string, string>,
	config: string,
) {
	if (binding.injection.type === "env") {
		const name = binding.injection.name;
		if (name in env) {
			throw new Error("資格情報の注入先が重複しています。");
		}
		env[name] = lease.use((material) =>
			material.secret.use((value) => value),
		);
		return;
	}
	if (binding.injection.type === "git-https") {
		await prepareGitHelper(lease, directory, env);
		return;
	}
	const text = lease.use((material) =>
		material.secret.use((value) => {
			if (/[\r\n\0]|\$\{/.test(value)) {
				throw new Error("npm の資格情報形式が不正です。");
			}
			const key = material.type === "npm-basic" ? "_auth" : "_authToken";
			return `//${binding.match.target.replace(/\/$/, "")}/:${key}=${value}\n`;
		}),
	);
	await appendFile(config, text);
}

/** ヘルパーのコマンドラインに秘密値を置かず、Host の既存 credential helper を無効にする。 */
async function prepareGitHelper(
	lease: CredentialLease,
	directory: string,
	env: Record<string, string>,
) {
	if (isNonEmptyString(env.GIT_ASKPASS)) {
		throw new Error("Git の資格情報対象が重複しています。");
	}
	const node = await providerExecutable("node", lease.requirement.workspace);
	if (!isNonEmptyString(node)) {
		throw new Error(
			"Git の資格情報ヘルパーに必要な Node.js がありません。",
		);
	}
	lease.use((material) => {
		env.NERITA_GIT_USERNAME =
			material.username?.use((value) => value) ?? "oauth2";
		env.NERITA_GIT_PASSWORD = material.secret.use((value) => value);
	});
	env.NERITA_GIT_TARGET = lease.requirement.target;
	const script = join(directory, "askpass.cjs");
	await writeFile(script, gitAskpassScript, { flag: "wx" });
	const helper = join(directory, "askpass.cmd");
	await writeFile(helper, `@"${node}" "${script}" "%~1"\r\n`, { flag: "wx" });
	Object.assign(env, {
		GIT_ASKPASS: helper,
		GIT_TERMINAL_PROMPT: "0",
		GIT_CONFIG_COUNT: "2",
		GIT_CONFIG_KEY_1: "credential.useHttpPath",
		GIT_CONFIG_VALUE_1: "true",
		GIT_CONFIG_KEY_0: "credential.helper",
		GIT_CONFIG_VALUE_0: "",
	});
}

/** `DevToolPolicy` の通常環境を確定した後で、承認済みの値だけを追加する。 */
export function applyCredentialInjection(
	config: ContainerConfig,
	injection?: CredentialInjection,
) {
	if (!injection) {
		return;
	}
	const keys = new Set(
		Object.keys(injection.env).map((key) => key.toLowerCase()),
	);
	const original = (config.process?.env ?? []).filter(
		(entry) => !keys.has(entry.slice(0, entry.indexOf("=")).toLowerCase()),
	);
	config.process = {
		...config.process!,
		env: [
			...original,
			...Object.entries(injection.env).map(
				([key, value]) => `${key}=${value}`,
			),
		],
	};
	config.filesystem = {
		...config.filesystem,
		readonlyPaths: [
			...(config.filesystem?.readonlyPaths ?? []),
			injection.directory,
		],
	};
}
/** Git が別のホストへ接続するときは、承認済みの認証をヘルパーから返さない。 */
const gitAskpassScript = `const prompt = process.argv[2] || "";
try {
 const url = new URL(prompt.match(/https:\\/\\/[^'\\"\\s]+/)[0]);
 const target = new URL("https://" + process.env.NERITA_GIT_TARGET);
 const path = target.pathname.replace(/\\/$/, "");
 if (url.host !== target.host || (path && !url.pathname.startsWith(path + "/") && url.pathname !== path)) process.exit(1);
 process.stdout.write(/username/i.test(prompt) ? process.env.NERITA_GIT_USERNAME : process.env.NERITA_GIT_PASSWORD);
} catch { process.exit(1); }
`;

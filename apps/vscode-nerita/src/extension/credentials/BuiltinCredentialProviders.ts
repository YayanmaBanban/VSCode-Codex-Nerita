// Git・npmrc・Bitwarden の参照を承認後に解決し、保管庫全体を探索しない。
import { fsErrorCode } from "../runtime/FsError";
import { isRecord } from "@nerita/shared/validation";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { throwCredentialError } from "./CredentialErrors";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { CredentialBinding } from "@nerita/shared/credentials";
import { SecretValue, type CredentialStore } from "./CredentialStore";
import type {
	CredentialCandidate,
	CredentialMaterial,
	CredentialProvider,
	CredentialRequirement,
} from "./CredentialProvider";
import { runProviderProcess, type ProviderProcess } from "./ProviderProcess";

/** inspect は参照の一致だけを調べ、CLI や認証ファイルを読まない。 */
abstract class BoundProvider implements CredentialProvider {
	abstract readonly id: string;
	inspect(
		requirement: CredentialRequirement,
		binding: CredentialBinding,
		signal: AbortSignal,
	) {
		signal.throwIfAborted();
		return Promise.resolve(
			binding.provider.type === this.id &&
				binding.match.kind === requirement.kind &&
				binding.match.target.toLowerCase() ===
					requirement.target.toLowerCase()
				? [
						{
							requirement: structuredClone(requirement),
							binding: structuredClone(binding),
							providerId: this.id,
						},
					]
				: [],
		);
	}
	abstract acquire(
		candidate: CredentialCandidate,
		signal: AbortSignal,
	): Promise<CredentialMaterial>;
}
export class GitCredentialProvider extends BoundProvider {
	readonly id = "git";
	constructor(private readonly run: ProviderProcess = runProviderProcess) {
		super();
	}
	async acquire(
		candidate: CredentialCandidate,
		signal: AbortSignal,
	): Promise<CredentialMaterial> {
		const [host, ...path] = candidate.requirement.target.split("/");
		const output = await this.run(
			"git",
			["credential", "fill"],
			candidate.requirement.workspace,
			signal,
			`protocol=https\nhost=${host}\n${path.length > 0 ? `path=${path.join("/")}\n` : ""}\n`,
			{ GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
		);
		const fields = Object.fromEntries(
			output
				.split(/\r?\n/)
				.filter((line) => line.includes("="))
				.map((line) => [
					line.slice(0, line.indexOf("=")),
					line.slice(line.indexOf("=") + 1),
				]),
		);
		if (
			!isNonEmptyString(fields.username) ||
			!isNonEmptyString(fields.password)
		) {
			throw new Error("Git の資格情報を取得できません。");
		}
		return {
			type: "username-password",
			username: new SecretValue(fields.username),
			secret: new SecretValue(fields.password),
		};
	}
}

/** ファイルサイズを制限し、解析失敗に元の設定文字列を含めない。 */
async function npmText(file: string) {
	try {
		const handle = await open(file, "r");
		try {
			if ((await handle.stat()).size > 64 * 1024) {
				throw new Error();
			}
			return await handle.readFile("utf8");
		} finally {
			await handle.close();
		}
	} catch (error) {
		if (fsErrorCode(error) === "ENOENT") {
			return "";
		}
		return throwCredentialError("npm 認証設定を読み込めません。", error);
	}
}
export class NpmConfigProvider extends BoundProvider {
	readonly id = "npmrc";
	constructor(
		private readonly userConfig = join(homedir(), ".npmrc"),
		private readonly env: NodeJS.ProcessEnv = process.env,
	) {
		super();
	}
	async acquire(
		candidate: CredentialCandidate,
		signal: AbortSignal,
	): Promise<CredentialMaterial> {
		signal.throwIfAborted();
		const settings = new Map<string, string>();
		for (const path of [
			this.userConfig,
			join(candidate.requirement.workspace, ".npmrc"),
		]) {
			for (const line of (await npmText(path)).split(/\r?\n/)) {
				const match = line.match(
					/^\s*(\/\/[^=\s]+:\s*(?:_authToken|_auth|username|_password))\s*=([^\r\n]*)$/i,
				);
				if (match) {
					settings.set(
						match[1]!.replace(/\s/g, ""),
						match[2]!.trim(),
					);
				}
			}
		}
		const target = candidate.requirement.target.replace(/\/$/, "");
		const scope = `//${target}/:`;
		const expand = (value: string) =>
			value.replace(/\$\{([A-Z_]\w*)\}/gi, (_match, name: string) => {
				const resolved = this.env[name];
				if (!isNonEmptyString(resolved)) {
					throw new Error("npm 認証の環境変数が設定されていません。");
				}
				return resolved;
			});
		signal.throwIfAborted();
		const token = settings.get(`${scope}_authToken`);
		if (isNonEmptyString(token)) {
			return { type: "token", secret: new SecretValue(expand(token)) };
		}
		const basic = settings.get(`${scope}_auth`);
		if (isNonEmptyString(basic)) {
			return {
				type: "npm-basic",
				secret: new SecretValue(expand(basic)),
			};
		}
		const username = settings.get(`${scope}username`);
		const password = settings.get(`${scope}_password`);
		if (isNonEmptyString(username) && isNonEmptyString(password)) {
			return {
				type: "npm-basic",
				secret: new SecretValue(
					Buffer.from(
						`${expand(username)}:${Buffer.from(expand(password), "base64").toString("utf8")}`,
					).toString("base64"),
				),
			};
		}
		throw new Error("対象レジストリの npm 認証設定がありません。");
	}
}

export class BitwardenSecretsProvider extends BoundProvider {
	readonly id = "bitwarden-secrets-manager";
	constructor(
		private readonly auth: CredentialStore,
		private readonly run: ProviderProcess = runProviderProcess,
	) {
		super();
	}
	async acquire(
		candidate: CredentialCandidate,
		signal: AbortSignal,
	): Promise<CredentialMaterial> {
		const provider = candidate.binding.provider;
		if (provider.type !== this.id) {
			throw new Error("Bitwarden の参照が一致しません。");
		}
		const token = await this.auth.get(`bws.auth.${provider.accountId}`);
		if (!token) {
			throw new Error("Bitwarden の認証を設定してください。");
		}
		try {
			const output = await token.use((value) =>
				this.run(
					"bws",
					["secret", "get", provider.secretId, "--output", "json"],
					candidate.requirement.workspace,
					signal,
					undefined,
					{ BWS_ACCESS_TOKEN: value },
				),
			);
			let secret: unknown;
			try {
				secret = JSON.parse(output);
			} catch {
				throw new Error("Bitwarden の応答形式が不正です。");
			}
			if (
				!isRecord(secret) ||
				secret.id !== provider.secretId ||
				(isNonEmptyString(provider.projectId) &&
					secret.projectId !== provider.projectId) ||
				typeof secret.value !== "string" ||
				secret.value === ""
			) {
				throw new Error(
					"Bitwarden の秘密情報またはプロジェクトの所属が一致しません。",
				);
			}
			signal.throwIfAborted();
			return { type: "token", secret: new SecretValue(secret.value) };
		} finally {
			token.dispose();
		}
	}
}

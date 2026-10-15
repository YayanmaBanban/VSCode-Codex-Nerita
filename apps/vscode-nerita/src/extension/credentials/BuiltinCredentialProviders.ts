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
	/** 参照と利用先の一致だけを確認し、承認前に CLI の実行や認証ファイルの読取りを行わない。 */
	inspect(
		requirement: CredentialRequirement,
		binding: CredentialBinding,
		signal: AbortSignal,
	) {
		signal.throwIfAborted();
		const matchingBinding =
			binding.provider.type === this.id &&
			binding.match.kind === requirement.kind;
		return Promise.resolve(
			matchingBinding &&
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
	/** 候補の秘密値を取得する。利用側は対象と取消しを確認し、取得後の値を秘密値ラッパーで保持する。 */
	abstract acquire(
		candidate: CredentialCandidate,
		signal: AbortSignal,
	): Promise<CredentialMaterial>;
}
/** Git の非対話認証から秘密値を取得する。利用側は承認済みの候補と中断シグナルを渡す。 */
export class GitCredentialProvider extends BoundProvider {
	readonly id = "git";
	/** Git の資格情報取得は注入したプロセス経路を使い、inspect では実行しない。 */
	constructor(private readonly run: ProviderProcess = runProviderProcess) {
		super();
	}
	/** 対話入力を無効にして対象の資格情報だけを取得し、必要なフィールドが欠けた応答を拒否する。 */
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

		if (!isNonEmptyString(fields.username)) {
			throw new Error("Git の資格情報を取得できません。");
		}
		if (!isNonEmptyString(fields.password)) {
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
			const matchesSize = (await handle.stat()).size > 64 * 1024;
			if (matchesSize) {
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
/** npm 設定から対象レジストリの認証を取得する。利用側は承認済みの候補と中断シグナルを渡す。 */
export class NpmConfigProvider extends BoundProvider {
	readonly id = "npmrc";
	/** ユーザー設定と環境変数の読取り元を固定し、参照の調査と秘密値の取得を分ける。 */
	constructor(
		private readonly userConfig = join(homedir(), ".npmrc"),
		private readonly env: NodeJS.ProcessEnv = process.env,
	) {
		super();
	}
	/** ユーザー設定の後にプロジェクト設定を適用し、対象レジストリの認証と環境変数だけを解決する。 */
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
		/** npm の認証設定にある環境変数参照を展開し、未設定の値を秘密値として扱わない。 */
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

/** 指定アカウントの Bitwarden 参照から秘密値を取得する。利用側は承認済みの候補と中断シグナルを渡す。 */
export class BitwardenSecretsProvider extends BoundProvider {
	readonly id = "bitwarden-secrets-manager";
	/** Bitwarden の認証保存先と CLI 実行経路を結び付け、秘密値を設定ファイルへ持ち込まない。 */
	constructor(
		private readonly auth: CredentialStore,
		private readonly run: ProviderProcess = runProviderProcess,
	) {
		super();
	}
	/** アカウントのトークンを CLI の環境だけへ渡し、取得した秘密 ID と所属を検証してから返す。 */
	async acquire(
		candidate: CredentialCandidate,
		signal: AbortSignal,
	): Promise<CredentialMaterial> {
		const provider = candidate.binding.provider;
		if (provider.type !== this.id) {
			throw new Error("指定された資格情報のプロバイダーが Bitwarden ではありません。");
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
			if (!isRecord(secret) || secret.id !== provider.secretId) {
				throw new Error(
					"Bitwarden の応答に、指定した ID の秘密情報が含まれていません。",
				);
			}

			const differentProject =
				isNonEmptyString(provider.projectId) &&
				secret.projectId !== provider.projectId;
			if (differentProject) {
				throw new Error(
					"Bitwarden の秘密情報が、指定したプロジェクトに属していません。",
				);
			}
			if (typeof secret.value !== "string") {
				throw new Error(
					"Bitwarden の秘密情報の値が文字列ではありません。",
				);
			}
			if (secret.value === "") {
				throw new Error(
					"Bitwarden の秘密情報の値が空です。",
				);
			}
			signal.throwIfAborted();
			return { type: "token", secret: new SecretValue(secret.value) };
		} finally {
			token.dispose();
		}
	}
}

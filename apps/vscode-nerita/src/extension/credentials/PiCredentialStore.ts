// Pi の非同期 `CredentialStore` でアカウント別に保存し、Host 全体で更新処理を直列化する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CredentialStorageMode } from "@nerita/shared/credentials";
import { type CredentialStores, SecretValue } from "./CredentialStore";

type SdkStore = NonNullable<
	NonNullable<Parameters<typeof PiSdk.ModelRuntime.create>[0]>["credentials"]
>;
type Credential = NonNullable<Awaited<ReturnType<SdkStore["read"]>>>;
type OperationOptions = Parameters<SdkStore["read"]>[1];
const accountSchema = z
	.object({
		id: z.uuid(),
		provider: z.string().min(1).max(128),
		name: z.string().min(1).max(128),
		mode: z.enum(["session", "secret-storage"]),
		type: z.enum(["api_key", "oauth"]),
	})
	.strict();
export type PiCredentialAccount = z.infer<typeof accountSchema>;
const indexSchema = z
	.object({
		accounts: z.array(accountSchema),
		active: z.record(z.string(), z.string()),
	})
	.strict();
/** OAuth の追加属性は SDK の Provider 固有データなので、秘密情報側にのみ保持する。 */
const credentialSchema = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("api_key"),
			key: z.string().optional(),
			env: z.record(z.string(), z.string()).optional(),
		})
		.strict()
		// SDK の exactOptionalPropertyTypes に合わせ、未指定のキーは値を undefined にせず省略する。
		.transform(({ type, key, env }) => ({
			type,
			...(key === undefined ? {} : { key }),
			...(env === undefined ? {} : { env }),
		})),
	z
		.object({
			type: z.literal("oauth"),
			access: z.string(),
			refresh: z.string(),
			expires: z.number(),
		})
		.loose(),
]);

/** メタデータには秘密値を入れず、複数の Runtime からの認証更新も同じ待機列を通す。 */
export class PiCredentialVault {
	private accounts: PiCredentialAccount[];
	private active: Record<string, string>;
	private readonly stagedAccounts = new Set<string>();
	private pending = Promise.resolve();
	constructor(
		readonly stores: CredentialStores,
		private readonly metadata: {
			read(): unknown;
			write(value: unknown): Promise<void>;
		},
	) {
		const value = metadata.read();
		const index =
			value === undefined
				? { accounts: [], active: {} }
				: indexSchema.parse(value);
		this.accounts = index.accounts;
		this.active = index.active;
	}
	list(provider?: string) {
		return structuredClone(
			this.accounts.filter(
				(account) =>
					!isNonEmptyString(provider) ||
					account.provider === provider,
			),
		);
	}
	selected(provider: string) {
		const account = this.accounts.find(
			(account) =>
				account.provider === provider &&
				account.id === this.active[provider],
		);
		return account ? structuredClone(account) : undefined;
	}
	/** Account を処理開始時に固定し、途中の切替で書込み先を変更しない。 */
	async read(
		account: PiCredentialAccount | undefined,
	): Promise<Credential | undefined> {
		if (!account) {
			return undefined;
		}
		const value = await this.stores
			.store(account.mode)
			.get(this.key(account));
		if (!value) {
			return undefined;
		}
		try {
			const credential = value.use((text) =>
				credentialSchema.parse(JSON.parse(text)),
			);
			this.stores.redactor.credential(credential);
			if (credential.type === "api_key") {
				for (const field of Object.values(credential.env ?? {})) {
					this.stores.redactor.protect(field);
				}
			}
			return credential;
		} catch {
			throw new Error("保存された Pi 認証を読み込めません。");
		} finally {
			value.dispose();
		}
	}
	modify(
		account: PiCredentialAccount | undefined,
		fn: Parameters<SdkStore["modify"]>[1],
		options?: OperationOptions,
	) {
		return this.enqueue(async () => {
			options?.signal?.throwIfAborted();
			const current =
				account && this.writable(account)
					? await this.read(account)
					: undefined;
			const next = await fn(current);
			options?.signal?.throwIfAborted();
			if (next === undefined) {
				return current;
			}
			if (!account || !this.writable(account)) {
				throw new Error("認証アカウントが利用できません。");
			}
			const validated = credentialSchema.parse(next);
			this.stores.redactor.credential(validated);
			const value = new SecretValue(JSON.stringify(validated));
			try {
				await this.stores
					.store(account.mode)
					.set(this.key(account), value);
			} finally {
				value.dispose();
			}
			return validated;
		});
	}
	async add(
		provider: string,
		type: Credential["type"],
		mode: CredentialStorageMode,
		name: string,
		login: (account: PiCredentialAccount) => Promise<unknown>,
	) {
		const account = accountSchema.parse({
			id: randomUUID(),
			provider,
			type,
			mode,
			name,
		});
		this.stagedAccounts.add(account.id);
		try {
			await login(account);
			if (!(await this.read(account))) {
				throw new Error("認証情報の保存を検証できません。");
			}
			await this.enqueue(() =>
				this.publish([...this.accounts, account], {
					...this.active,
					[provider]: account.id,
				}),
			);
		} catch (error) {
			await this.stores.store(mode).delete(this.key(account));
			throw error;
		} finally {
			this.stagedAccounts.delete(account.id);
		}
	}
	private writable(account: PiCredentialAccount) {
		return (
			this.accounts.some((item) => item.id === account.id) ||
			this.stagedAccounts.has(account.id)
		);
	}
	select(provider: string, id: string) {
		return this.enqueue(async () => {
			const account = this.accounts.find(
				(item) => item.provider === provider && item.id === id,
			);
			if (!account || !(await this.read(account))) {
				throw new Error("認証アカウントが利用できません。");
			}
			await this.publish(this.accounts, {
				...this.active,
				[provider]: id,
			});
		});
	}
	remove(
		account: PiCredentialAccount | undefined,
		options?: OperationOptions,
	) {
		return this.enqueue(async () => {
			options?.signal?.throwIfAborted();
			if (!account) {
				return;
			}
			const next = this.accounts.filter((item) => item.id !== account.id);
			const active = { ...this.active };
			if (active[account.provider] === account.id) {
				delete active[account.provider];
			}
			await this.stores.store(account.mode).delete(this.key(account));
			await this.publish(next, active);
		});
	}
	/** 読み戻し済みの値だけを確定でき、取消しでは新しい保存値を回収する。 */
	async stageImport(records: unknown, mode: CredentialStorageMode) {
		const parsed = z
			.record(z.string().min(1).max(128), credentialSchema)
			.parse(records);
		const staged: PiCredentialAccount[] = [];
		const clean = async () => {
			for (const account of staged) {
				await this.stores.store(mode).delete(this.key(account));
			}
		};
		try {
			for (const [provider, credential] of Object.entries(parsed)) {
				const account = accountSchema.parse({
					id: randomUUID(),
					provider,
					type: credential.type,
					mode,
					name: "既存 Pi 認証",
				});
				staged.push(account);
				const value = new SecretValue(JSON.stringify(credential));
				try {
					await this.stores.store(mode).set(this.key(account), value);
				} finally {
					value.dispose();
				}
				if (
					JSON.stringify(await this.read(account)) !==
					JSON.stringify(credential)
				) {
					throw new Error("移行先の認証情報が一致しません。");
				}
			}
		} catch (error) {
			await clean();
			throw error;
		}
		let finished = false;
		return {
			count: staged.length,
			commit: () =>
				this.enqueue(async () => {
					if (finished) {
						throw new Error("移行の確定操作は既に終了しています。");
					}
					const active = { ...this.active };
					for (const account of staged) {
						active[account.provider] ??= account.id;
					}
					await this.publish([...this.accounts, ...staged], active);
					finished = true;
				}),
			cancel: async () => {
				if (!finished) {
					finished = true;
					await clean();
				}
			},
		};
	}
	/** 永続メタデータは永続アカウントだけ。セッションの名前も終了後に残さない。 */
	private async publish(
		accounts: PiCredentialAccount[],
		active: Record<string, string>,
	) {
		const persistent = accounts.filter(
			(item) => item.mode === "secret-storage",
		);
		await this.metadata.write({
			accounts: persistent,
			active: Object.fromEntries(
				Object.entries(active).filter(([, id]) =>
					persistent.some((item) => item.id === id),
				),
			),
		});
		this.accounts = accounts;
		this.active = active;
	}
	private key(account: PiCredentialAccount) {
		return `pi.auth.${encodeURIComponent(account.provider)}.${account.id}`;
	}
	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.pending.then(operation);
		this.pending = result.then(
			() => {},
			() => {},
		);
		return result;
	}
}

/** Runtime ごとのログイン先と、Host 全体の選択中アカウントを分けて扱う。 */
export class PiCredentialStore implements SdkStore {
	private readonly loginAccounts = new Map<string, PiCredentialAccount>();
	constructor(readonly vault: PiCredentialVault) {}
	private account(provider: string) {
		return (
			this.loginAccounts.get(provider) ?? this.vault.selected(provider)
		);
	}
	async read(provider: string, options?: OperationOptions) {
		options?.signal?.throwIfAborted();
		return this.vault.read(this.account(provider));
	}
	list(options?: OperationOptions) {
		options?.signal?.throwIfAborted();
		return Promise.resolve(
			this.vault
				.list()
				.filter(
					(account) =>
						this.vault.selected(account.provider)?.id ===
						account.id,
				)
				.map((account) => ({
					providerId: account.provider,
					type: account.type,
				})),
		);
	}
	modify(
		provider: string,
		fn: Parameters<SdkStore["modify"]>[1],
		options?: OperationOptions,
	) {
		return this.vault.modify(this.account(provider), fn, options);
	}
	delete(provider: string, options?: OperationOptions) {
		return this.vault.remove(this.account(provider), options);
	}
	/** 既存の認証を上書きせず、SDK の保存先だけを新しい Account へ結び付ける。 */
	async login(
		provider: string,
		type: Credential["type"],
		mode: CredentialStorageMode,
		name: string,
		action: () => Promise<unknown>,
	) {
		if (this.loginAccounts.has(provider)) {
			throw new Error("認証処理が実行中です。");
		}
		await this.vault.add(provider, type, mode, name, async (account) => {
			this.loginAccounts.set(provider, account);
			try {
				await action();
			} finally {
				this.loginAccounts.delete(provider);
			}
		});
	}
}

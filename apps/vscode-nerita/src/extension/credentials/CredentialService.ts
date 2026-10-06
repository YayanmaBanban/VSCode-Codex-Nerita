// `ExtensionContext` ごとに保存先と Pi の更新待機列を共有し、バックエンド切替で秘密値を複製しない。
import type * as vscode from "vscode";
import {
	CredentialStores,
	SecretValue,
	VsCodeSecretCredentialStore,
	type CredentialStore,
} from "./CredentialStore";
import { PiCredentialStore, PiCredentialVault } from "./PiCredentialStore";
import {
	BitwardenSecretsProvider,
	GitCredentialProvider,
	NpmConfigProvider,
} from "./BuiltinCredentialProviders";
import { CredentialProviderRegistry } from "./CredentialProvider";
import { CredentialBroker } from "./CredentialBroker";
import { BindingStore } from "./BindingStore";
import type { CommandPermissions } from "../runtime/CommandPermissions";
import type { CredentialStorageMode } from "@nerita/shared/credentials";
import { z } from "zod";
import { SecretAuthBackend } from "./SecretAuthBackend";

const services = new WeakMap<vscode.ExtensionContext, CredentialService>();
/** SecretStorage に秘密値を保存し、`globalState` には保存モードやアカウントのメタデータを保存する。 */
export class CredentialService {
	readonly stores: CredentialStores;
	readonly vault: PiCredentialVault;
	private readonly bwsSession = new Map<string, CredentialStorageMode>();
	private readonly bwsModes: Record<string, CredentialStorageMode>;
	readonly bws: CredentialStore;
	private readonly bindingStores = new Map<string, BindingStore>();
	private bwsPending = Promise.resolve();
	private mcp: Promise<SecretAuthBackend> | undefined;
	constructor(
		private readonly context: Pick<
			vscode.ExtensionContext,
			"secrets" | "globalState"
		>,
	) {
		this.stores = new CredentialStores(
			new VsCodeSecretCredentialStore(context.secrets),
		);
		this.vault = new PiCredentialVault(this.stores, {
			read: () => context.globalState.get("nerita.pi.accounts"),
			write: async (value) => {
				await context.globalState.update("nerita.pi.accounts", value);
			},
		});
		this.bwsModes = z
			.record(z.string(), z.literal("secret-storage"))
			.parse(context.globalState.get("nerita.bws.modes", {}));
		this.bws = {
			get: (key) => this.readBws(key),
			set: () =>
				Promise.reject(
					new Error("Bitwarden の保存モードを指定してください。"),
				),
			delete: (key) => this.logoutBws(key.slice("bws.auth.".length)),
		};
	}
	piStore() {
		return new PiCredentialStore(this.vault);
	}
	/** 再起動後に取得した BWS 認証も、Provider の起動前に出力保護へ登録する。 */
	private async readBws(key: string) {
		const id = key.slice("bws.auth.".length);
		const mode = this.bwsSession.get(id) ?? this.bwsModes[id];
		if (!(mode !== undefined)) {
			return undefined;
		}
		const value = await this.stores.store(mode).get(key);
		value?.use((text) => this.stores.redactor.protect(text));
		return value;
	}
	/** 複数の管理パネルからのログイン・削除を同じ待機列へ通す。 */
	private enqueueBws(operation: () => Promise<void>) {
		const result = this.bwsPending.then(operation);
		this.bwsPending = result.catch(() => {});
		return result;
	}
	mcpBackend() {
		return (this.mcp ??= SecretAuthBackend.create(
			this.stores.persistent,
			this.stores.redactor,
		));
	}
	bindings(root: string) {
		let store = this.bindingStores.get(root);
		if (!store) {
			store = new BindingStore(root);
			this.bindingStores.set(root, store);
		}
		return store;
	}
	broker(root: string, grants?: CommandPermissions) {
		return new CredentialBroker(
			this.bindings(root),
			new CredentialProviderRegistry([
				new GitCredentialProvider(),
				new NpmConfigProvider(),
				new BitwardenSecretsProvider(this.bws),
			]),
			this.stores.redactor,
			grants,
		);
	}
	bwsMode(id: string) {
		return this.bwsSession.get(id) ?? this.bwsModes[id] ?? null;
	}
	/** 保存済みの非秘密 ID を一覧にし、未設定の既定アカウントも表示する。 */
	bwsAccounts() {
		return [
			...new Set([
				"default",
				...this.bwsSession.keys(),
				...Object.keys(this.bwsModes),
			]),
		];
	}
	loginBws(id: string, mode: CredentialStorageMode, token: string) {
		return this.enqueueBws(() => this.saveBws(id, mode, token));
	}
	private async saveBws(
		id: string,
		mode: CredentialStorageMode,
		token: string,
	) {
		if (token === "" || /[\r\n\0]/.test(token)) {
			throw new Error("Bitwarden のトークン形式が不正です。");
		}
		this.stores.redactor.protect(token);
		const next = { ...this.bwsModes };
		if (mode === "secret-storage") {
			next[id] = mode;
		} else {
			delete next[id];
		}
		await this.saveBwsMode(id, mode, token, next);
		Object.keys(this.bwsModes).forEach((key) => delete this.bwsModes[key]);
		Object.assign(this.bwsModes, next);
		if (mode === "session") {
			this.bwsSession.set(id, mode);
			await this.stores.persistent.delete(`bws.auth.${id}`);
		} else {
			this.bwsSession.delete(id);
			await this.stores.memory.delete(`bws.auth.${id}`);
		}
	}
	/** モードの保存が失敗した場合、新しい保存先へ書いた値を元に戻す。 */
	private async saveBwsMode(
		id: string,
		mode: CredentialStorageMode,
		token: string,
		modes: Record<string, CredentialStorageMode>,
	) {
		const store = this.stores.store(mode);
		const key = `bws.auth.${id}`;
		const previous = await store.get(key);
		const value = new SecretValue(token);
		try {
			await store.set(key, value);
			await this.context.globalState.update("nerita.bws.modes", modes);
		} catch (error) {
			if (previous) {
				await store.set(key, previous);
			} else {
				await store.delete(key);
			}
			throw error;
		} finally {
			previous?.dispose();
			value.dispose();
		}
	}
	logoutBws(id: string) {
		return this.enqueueBws(() => this.removeBws(id));
	}
	private async removeBws(id: string) {
		await this.stores.memory.delete(`bws.auth.${id}`);
		await this.stores.persistent.delete(`bws.auth.${id}`);
		const next = { ...this.bwsModes };
		delete next[id];
		await this.context.globalState.update("nerita.bws.modes", next);
		this.bwsSession.delete(id);
		delete this.bwsModes[id];
	}
	dispose() {
		void this.mcp?.then(
			(backend) => backend.dispose(),
			() => {},
		);
		this.stores.dispose();
		this.bwsSession.clear();
	}
}

export function credentialService(context: vscode.ExtensionContext) {
	let service = services.get(context);
	if (!service) {
		service = new CredentialService(context);
		services.set(context, service);
		context.subscriptions.push(service);
	}
	return service;
}

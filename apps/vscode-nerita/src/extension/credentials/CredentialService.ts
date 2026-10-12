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
	/** 秘密値は SecretStorage、アカウント索引と保存モードは globalState に分けて保持する。 */
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
	/** バックエンドごとの SDK アダプターも、同じ保管庫と更新待機列を使う。 */
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
	/** MCP の保管先は初回だけ生成し、複数の接続で永続保存と秘密除去を共有する。 */
	mcpBackend() {
		return (this.mcp ??= SecretAuthBackend.create(
			this.stores.persistent,
			this.stores.redactor,
		));
	}
	/** 同じルートの設定ストアを共有し、別ルートの参照設定と混ぜない。 */
	bindings(root: string) {
		let store = this.bindingStores.get(root);
		if (!store) {
			store = new BindingStore(root);
			this.bindingStores.set(root, store);
		}
		return store;
	}
	/** ルート別の参照設定へ組込みの取得元と共有の秘密除去を結び付ける。 */
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
	/** Host 内の一時保存を優先し、未設定のアカウントは保存先を推測しない。 */
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
	/** ログインと削除を同じ待機列へ通し、保存モードの更新を競合させない。 */
	loginBws(id: string, mode: CredentialStorageMode, token: string) {
		return this.enqueueBws(() => this.saveBws(id, mode, token));
	}
	/** トークンの形式と保存を確認してからモードを公開し、旧モードに残った秘密値を削除する。 */
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
	/** ログインと同じ待機列で削除し、遅い保存処理が削除後の状態を上書きしないようにする。 */
	logoutBws(id: string) {
		return this.enqueueBws(() => this.removeBws(id));
	}
	/** 両保存先の秘密値を削除してからモード索引を更新し、利用不能な保存先を残さない。 */
	private async removeBws(id: string) {
		await this.stores.memory.delete(`bws.auth.${id}`);
		await this.stores.persistent.delete(`bws.auth.${id}`);
		const next = { ...this.bwsModes };
		delete next[id];
		await this.context.globalState.update("nerita.bws.modes", next);
		this.bwsSession.delete(id);
		delete this.bwsModes[id];
	}
	/** MCP の保管処理と Host 内の秘密値を解放し、永続アカウントの情報は保持する。 */
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

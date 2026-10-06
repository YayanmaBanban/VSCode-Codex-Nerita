// 同期の MCP SDK 保存 API をメモリーへ接続し、非同期の秘密保存が完了してから結果を公開する。
import {
	SecretValue,
	type CredentialStore,
	type SecretRedactor,
} from "./CredentialStore";

type Change<T> = { result: T; next?: string };
/** 初期読込みと flush を必ず待ち、保存失敗を次の同期操作でも検出する。 */
export class SecretAuthBackend {
	private value: string | undefined;
	private pending = Promise.resolve();
	private failure: Error | undefined;
	private readonly refreshes = new Map<string, Promise<void>>();
	private constructor(
		private readonly store: CredentialStore,
		private readonly redactor: SecretRedactor,
	) {}
	static async create(store: CredentialStore, redactor: SecretRedactor) {
		const backend = new SecretAuthBackend(store, redactor);
		const value = await store.get("pi.mcp.auth");
		try {
			backend.value = value?.use((text) => text);
			backend.protect();
		} finally {
			value?.dispose();
		}
		return backend;
	}
	withLock<T>(fn: (current: string | undefined) => Change<T>): T {
		if (this.failure) {
			throw this.failure;
		}
		const changed = fn(this.value);
		if (changed.next !== undefined) {
			this.value = changed.next;
			this.protect();
			const value = new SecretValue(changed.next);
			this.pending = this.pending
				.then(() => this.store.set("pi.mcp.auth", value))
				.catch(() => {
					this.failure = new Error("MCP 認証を保存できません。");
				})
				.finally(() => value.dispose());
		}
		return changed.result;
	}
	async flush() {
		await this.pending;
		if (this.failure) {
			throw this.failure;
		}
	}
	/** 子 Runtime を含む同じ Host 内で、MCP のリフレッシュトークンの更新を直列化する。 */
	withRefreshLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
		const result = (this.refreshes.get(key) ?? Promise.resolve()).then(
			operation,
		);
		const settled = result.then(
			() => {},
			() => {},
		);
		this.refreshes.set(key, settled);
		void settled.then(() => {
			if (this.refreshes.get(key) === settled) {
				this.refreshes.delete(key);
			}
		});
		return result;
	}
	dispose() {
		this.value = undefined;
	}
	private protect() {
		if (!this.value) {
			return;
		}
		let value: unknown;
		try {
			value = JSON.parse(this.value);
		} catch {
			throw new Error("MCP 認証の形式が不正です。");
		}
		this.redactor.credential(value);
	}
}

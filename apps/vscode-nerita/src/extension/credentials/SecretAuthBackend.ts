// 同期の MCP SDK 保存 API をメモリーへ接続し、非同期の秘密保存が完了してから結果を公開する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
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
	/** MCP の認証保存先と秘密除去を共有し、生成は保存値の読取りを行う create 経由に限定する。 */
	private constructor(
		private readonly store: CredentialStore,
		private readonly redactor: SecretRedactor,
	) {}
	/** 保存値を復元して出力保護へ登録し、読取り用のラッパーは成功・失敗にかかわらず解放する。 */
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
	/** SDK の同期更新をキャッシュへ反映し、永続書込みは直列化する。保存失敗後の更新は拒否する。 */
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
	/** 待機中の保存を確認し、非同期書込みの失敗も利用側へ伝える。 */
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
	/** このアダプターの認証文字列への参照を解放し、永続保存済みの認証は削除しない。 */
	dispose() {
		this.value = undefined;
	}
	/** 認証 JSON を検証して秘密フィールドを出力保護へ登録し、解析に失敗しても元の値をエラーへ含めない。 */
	private protect() {
		if (!isNonEmptyString(this.value)) {
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

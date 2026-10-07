// 秘密情報はメモリーか VS Code の保管 API へ委譲し、通常の JSON 保存先へ渡さない。
import { nonZeroNumber } from "@nerita/shared/valuePredicates";
import type { CredentialStorageMode } from "@nerita/shared/credentials";

/** JSON と表示文字列では秘密値を公開しない。値を使う側は取得目的を限定する。 */
export class SecretValue {
	#value: string;
	constructor(value: string) {
		this.#value = value;
	}
	use<T>(action: (value: string) => T): T {
		return action(this.#value);
	}
	toJSON() {
		return "[REDACTED]";
	}
	toString() {
		return "[REDACTED]";
	}
	dispose() {
		this.#value = "";
	}
}

/** ストア全体を列挙せず、実際に使用した値だけを出力の伏字に登録する。 */
export class SecretRedactor {
	private readonly values = new Set<string>();
	protect(value: string) {
		if (value !== "") {
			this.values.add(value);
		}
	}
	text(value: string): string {
		let safe = "";
		let cursor = 0;
		for (const range of this.ranges(value)) {
			safe += `${value.slice(cursor, range.start)}[REDACTED]`;
			cursor = range.end;
		}
		return safe + value.slice(cursor);
	}
	/** 元の文字列上で全一致を探し、重なる秘密値は連結した区間全体を保護する。 */
	ranges(value: string): { start: number; end: number }[] {
		const matches: { start: number; end: number }[] = [];
		for (const secret of this.variants()) {
			let start = value.indexOf(secret);
			while (start >= 0) {
				matches.push({ start, end: start + secret.length });
				start = value.indexOf(secret, start + 1);
			}
		}
		matches.sort(
			(a, b) => nonZeroNumber(a.start - b.start) ?? b.end - a.end,
		);
		const merged: typeof matches = [];
		for (const match of matches) {
			const last = merged.at(-1);
			if (last && match.start <= last.end) {
				last.end = Math.max(last.end, match.end);
			} else {
				merged.push({ ...match });
			}
		}
		return merged;
	}
	/** 保護処理内だけで使う。保存ストア全体を読み取る API ではない。 */
	variants(): string[] {
		return [
			...new Set(
				[...this.values].flatMap((secret) => [
					secret,
					encodeURIComponent(secret),
					Buffer.from(secret).toString("base64"),
					JSON.stringify(secret).slice(1, -1),
				]),
			),
		].sort((a, b) => b.length - a.length);
	}
	credential(value: unknown) {
		if (value === null || typeof value !== "object") {
			return;
		}
		for (const [key, field] of Object.entries(value)) {
			if (typeof field === "object") {
				this.credential(field);
			}
			if (
				typeof field === "string" &&
				/key|access|refresh|token|password|secret/i.test(key)
			) {
				this.protect(field);
			}
		}
	}
	/** JSON 化で型や構造が変わるため、具体型への復帰は利用側の検証に委ねる。 */
	value(value: unknown): unknown {
		const json: unknown = JSON.stringify(value);
		if (typeof json !== "string") {
			return value;
		}
		return JSON.parse(json, (_key, field: unknown) =>
			typeof field === "string" ? this.text(field) : field,
		);
	}
	dispose() {
		this.values.clear();
	}
}

/** 保存方式を越えて暗黙のフォールバックを行わない。 */
export type CredentialStore = {
	get(key: string): Promise<SecretValue | undefined>;
	set(key: string, value: SecretValue): Promise<void>;
	delete(key: string): Promise<void>;
};

/** Extension Host の寿命だけ保持する。チャットの切替では消さない。 */
export class SessionMemoryCredentialStore implements CredentialStore {
	private readonly values = new Map<string, string>();
	get(key: string) {
		const value = this.values.get(key);
		return Promise.resolve(
			value === undefined ? undefined : new SecretValue(value),
		);
	}
	set(key: string, value: SecretValue) {
		this.values.set(
			key,
			value.use((text) => text),
		);
		return Promise.resolve();
	}
	delete(key: string) {
		this.values.delete(key);
		return Promise.resolve();
	}
	dispose() {
		this.values.clear();
	}
}

/** VS Code API と同じ非同期契約を使い、独自の暗号化ファイルを作らない。 */
export class VsCodeSecretCredentialStore implements CredentialStore {
	constructor(
		private readonly secrets: {
			get(key: string): Thenable<string | undefined>;
			store(key: string, value: string): Thenable<void>;
			delete(key: string): Thenable<void>;
		},
	) {}
	async get(key: string) {
		const value = await this.secrets.get(key);
		return value === undefined ? undefined : new SecretValue(value);
	}
	async set(key: string, value: SecretValue) {
		await value.use((text) => this.secrets.store(key, text));
	}
	async delete(key: string) {
		await this.secrets.delete(key);
	}
}

/** 保存モードを明示して使用する2つの保存先。 */
export class CredentialStores {
	readonly memory = new SessionMemoryCredentialStore();
	constructor(
		readonly persistent: CredentialStore,
		readonly redactor = new SecretRedactor(),
	) {}
	store(mode: CredentialStorageMode): CredentialStore {
		return mode === "session" ? this.memory : this.persistent;
	}
	dispose() {
		this.memory.dispose();
		this.redactor.dispose();
	}
}

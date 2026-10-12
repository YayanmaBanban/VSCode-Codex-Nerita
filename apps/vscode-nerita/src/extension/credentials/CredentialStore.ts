// 秘密情報はメモリーか VS Code の保管 API へ委譲し、通常の JSON 保存先へ渡さない。
import { nonZeroNumber } from "@nerita/shared/valuePredicates";
import type { CredentialStorageMode } from "@nerita/shared/credentials";

/** JSON と表示文字列では秘密値を公開しない。値を使う側は取得目的を限定する。 */
export class SecretValue {
	#value: string;
	/** 秘密値は非公開フィールドへ隔離し、表示・JSON 化の経路から直接参照させない。 */
	constructor(value: string) {
		this.#value = value;
	}
	/** 秘密値は指定した用途のコールバックへだけ渡す。戻り値をログや表示へ渡す場合は利用側で保護する。 */
	use<T>(action: (value: string) => T): T {
		return action(this.#value);
	}
	/** JSON 保存時は元の秘密値を含めず、伏字だけを返す。 */
	toJSON() {
		return "[REDACTED]";
	}
	/** 文字列への暗黙変換でも秘密値を露出させない。 */
	toString() {
		return "[REDACTED]";
	}
	/** このラッパーが保持する秘密値への参照を手放す。既に利用側へ渡った文字列の消去は保証しない。 */
	dispose() {
		this.#value = "";
	}
}

/** ストア全体を列挙せず、実際に使用した値だけを出力の伏字に登録する。 */
export class SecretRedactor {
	private readonly values = new Set<string>();
	/** 実際に使用する秘密値だけを登録し、空文字で本文全体を置換しない。 */
	protect(value: string) {
		if (value !== "") {
			this.values.add(value);
		}
	}
	/** 重なる秘密値の区間もまとめて伏字へ置換し、公開する本文に元の値を残さない。 */
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
	/** 認証データを再帰的に確認し、秘密を表すキーの文字列だけを出力保護へ登録する。 */
	credential(value: unknown) {
		if (value === null || typeof value !== "object") {
			return;
		}
		for (const [key, field] of Object.entries(value)) {
			if (typeof field === "object") {
				this.credential(field);
			}

			if (typeof field !== "string") {
				continue;
			}
			if (/key|access|refresh|token|password|secret/i.test(key)) {
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
	/** Host の終了時に保護対象の値を解放し、次の Host へ引き継がない。 */
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
	/** 取得ごとに表示を保護するラッパーを作り、保存マップ自体は公開しない。 */
	get(key: string) {
		const value = this.values.get(key);
		return Promise.resolve(
			value === undefined ? undefined : new SecretValue(value),
		);
	}
	/** 選択されたメモリー保存だけに値を保持し、永続保存へフォールバックしない。 */
	set(key: string, value: SecretValue) {
		this.values.set(
			key,
			value.use((text) => text),
		);
		return Promise.resolve();
	}
	/** 指定した秘密値をメモリー保存から取り除き、他の保存モードは変更しない。 */
	delete(key: string) {
		this.values.delete(key);
		return Promise.resolve();
	}
	/** Host の寿命が終わったときに全てのメモリー保存を解放する。 */
	dispose() {
		this.values.clear();
	}
}

/** VS Code API と同じ非同期契約を使い、独自の暗号化ファイルを作らない。 */
export class VsCodeSecretCredentialStore implements CredentialStore {
	/** 永続保存は注入した VS Code の秘密保管 API を使い、独自の保存ファイルを作らない。 */
	constructor(
		private readonly secrets: {
			get(key: string): Thenable<string | undefined>;
			store(key: string, value: string): Thenable<void>;
			delete(key: string): Thenable<void>;
		},
	) {}
	/** 永続値も秘密値ラッパーで返し、保管 API の生の文字列を直接公開しない。 */
	async get(key: string) {
		const value = await this.secrets.get(key);
		return value === undefined ? undefined : new SecretValue(value);
	}
	/** 秘密値の使用経路の中だけで VS Code の保管 API へ値を渡す。 */
	async set(key: string, value: SecretValue) {
		await value.use((text) => this.secrets.store(key, text));
	}
	/** 削除を保管 API の完了まで待ち、失敗を成功として扱わない。 */
	async delete(key: string) {
		await this.secrets.delete(key);
	}
}

/** 保存モードを明示して使用する2つの保存先。 */
export class CredentialStores {
	readonly memory = new SessionMemoryCredentialStore();
	/** 永続保存先と出力保護を共有し、各保存モードで同じ秘密値の扱いを使う。 */
	constructor(
		readonly persistent: CredentialStore,
		readonly redactor = new SecretRedactor(),
	) {}
	/** 明示された保存モードだけを選び、保存先の失敗で別のモードへ切り替えない。 */
	store(mode: CredentialStorageMode): CredentialStore {
		return mode === "session" ? this.memory : this.persistent;
	}
	/** メモリーと出力保護だけを解放し、永続保存した資格情報は削除しない。 */
	dispose() {
		this.memory.dispose();
		this.redactor.dispose();
	}
}

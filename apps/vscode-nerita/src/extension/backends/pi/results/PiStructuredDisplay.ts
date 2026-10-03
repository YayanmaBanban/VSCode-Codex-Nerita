// 生の構造化結果を Webview へ渡さず、有限の走査で表示用 JSON を作る。
import { PiDisplayText } from "./PiDisplayText";

/** 循環、非公開情報、巨大な結果を表示用の説明へ置き換える。 */
export function piStructuredDisplay(
	value: unknown,
	secrets: readonly string[] = [],
) {
	const output = new PiDisplayText();
	const traversal = new StructuredDisplay(output, secrets);
	try {
		traversal.value(value, 0);
	} catch {
		// 不正なアクセサーや Proxy の例外も、ツールカードの描画を止めない。
		output.omitted = true;
		output.append("[構造化結果を表示できません。]");
	}
	return { text: output.finish(), omitted: output.omitted };
}

/** 参照経路とノード数を保持し、getter や toJSON を実行しない。 */
class StructuredDisplay {
	private ancestors = new Set<object>();
	private nodes = 0;

	/** 結果ごとに出力サイズを制限し、Host が把握する秘密値を除去する。 */
	constructor(
		private output: PiDisplayText,
		private secrets: readonly string[],
	) {}

	/** 型と深さを検証し、小さい値だけを出力する。 */
	value(value: unknown, depth: number): void {
		if (this.output.full) {
			return;
		}
		if (++this.nodes > 200 || depth > 6) {
			this.omit("上限により省略");
			return;
		}
		if (value !== null && typeof value === "object") {
			this.object(value, depth);
			return;
		}
		this.scalar(value);
	}

	/** JSON に対応するスカラー以外は、安全な説明にする。 */
	private scalar(value: unknown): void {
		if (typeof value === "string") {
			if (binaryString(value)) {
				this.omit("base64を省略");
				return;
			}
			this.output.append(
				JSON.stringify(this.output.string(value, this.secrets)),
			);
			return;
		}
		if (value === null || typeof value === "boolean") {
			this.output.append(String(value));
			return;
		}
		if (typeof value === "number" && Number.isFinite(value)) {
			this.output.append(String(value));
			return;
		}
		this.omit("非対応の値");
	}

	/** バイナリーと SDK 専用のインスタンスを公開せず、循環を止める。 */
	private object(value: object, depth: number): void {
		if (this.ancestors.has(value)) {
			this.omit("循環参照");
			return;
		}
		if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
			this.omit("バイナリーを省略");
			return;
		}
		const array = Array.isArray(value);
		const prototype: unknown = Object.getPrototypeOf(value);
		if (!array && prototype !== Object.prototype && prototype !== null) {
			this.omit("非対応のオブジェクト");
			return;
		}
		this.ancestors.add(value);
		this.output.append(array ? "[" : "{");
		this.entries(value, array, depth);
		this.output.append(array ? "]" : "}");
		this.ancestors.delete(value);
	}

	/** 全キーの配列を作らず、1 コンテナー50 項目で走査を止める。 */
	private entries(value: object, array: boolean, depth: number): void {
		let count = 0;
		for (const key in value) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor) {
				continue;
			}
			if (this.output.full || this.nodes >= 200 || count >= 50) {
				this.output.omitted = true;
				break;
			}
			if (count++) {
				this.output.append(",");
			}
			this.output.append(`\n${"  ".repeat(depth + 1)}`);
			this.entry(key, descriptor, array, depth);
		}
		if (count && !this.output.full) {
			this.output.append(`\n${"  ".repeat(depth)}`);
		}
	}

	/** キーに応じて非公開の値を隠し、アクセサーは呼び出さない。 */
	private entry(
		key: string,
		descriptor: PropertyDescriptor,
		array: boolean,
		depth: number,
	): void {
		if (!array) {
			this.output.append(
				`${JSON.stringify(this.output.string(key, this.secrets))}: `,
			);
		}
		if (privateKey(key) || !Object.hasOwn(descriptor, "value")) {
			this.nodes++;
			this.omit("非公開");
			return;
		}
		if (binaryString(descriptor.value)) {
			this.nodes++;
			this.omit("base64を省略");
			return;
		}
		this.value(descriptor.value, depth + 1);
	}

	/** 値を除いた理由を、本文と省略情報へ残す。 */
	private omit(reason: string): void {
		this.output.omitted = true;
		this.output.append(JSON.stringify(`[${reason}]`));
	}
}

/** 認証情報と MCP の非公開メタデータは、キーの表記差にも対応して隠す。 */
function privateKey(key: string): boolean {
	const normalized = key
		.slice(0, 4096)
		.replace(/[^a-z0-9]/gi, "")
		.toLowerCase();
	return (
		key.length > 4096 ||
		key === "_meta" ||
		/authorization|headers|cookie|password|secret|token|credential|apikey|privatekey|base64|binary|blob/.test(
			normalized,
		)
	);
}

/** 長い base64 や data URI を、全文の正規表現処理なしで除外する。 */
function binaryString(value: unknown): boolean {
	if (typeof value !== "string") {
		return false;
	}
	const prefix = value.slice(0, 1024);
	return (
		/^data:[^,]*;base64,/i.test(prefix) ||
		(value.length >= 256 && /^[a-z0-9+/=\r\n]+$/i.test(prefix))
	);
}

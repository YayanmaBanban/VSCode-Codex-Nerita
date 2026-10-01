// 表示用文字列の秘密値を隠し、UTF-8 の上限を生成時に適用する。
export const piDisplayLimit = 32 * 1024;
const omission = "\n[表示上限または非公開情報のため、一部を省略しました。]";
const privateText = "[非公開]";

/** UTF-8 の境界で止め、巨大な元文字列を全体走査しない。 */
export function displayPrefix(value: string, bytes: number): string {
	let size = 0;
	let end = 0;
	for (const character of value) {
		const length = Buffer.byteLength(character, "utf8");
		if (size + length > bytes) {
			break;
		}
		size += length;
		end += character.length;
	}
	return value.slice(0, end);
}

/** Host が把握する秘密値を、切り詰める前に限定した範囲で除去する。 */
export function privateDisplayText(
	value: string,
	bytes: number,
	secrets: readonly string[],
): { text: string; omitted: boolean } {
	const longest = secrets.reduce(
		(length, secret) => Math.max(length, secret.length),
		0,
	);
	// 上限をまたぐ秘密値も照合できる分だけ先読みする。
	let text = value.slice(0, bytes + longest);
	let omitted = text.length < value.length;
	for (const secret of secrets) {
		if (secret && text.includes(secret)) {
			text = text.replaceAll(secret, privateText);
			omitted = true;
		}
	}
	const prefix = displayPrefix(text, bytes);
	return { text: prefix, omitted: omitted || prefix.length < text.length };
}

/** 省略の説明を含め、1 結果の出力を 32 KiB 以内に収める。 */
export class PiDisplayText {
	private parts: string[] = [];
	private remaining = piDisplayLimit - Buffer.byteLength(omission, "utf8");
	omitted = false;

	/** 出力が上限に達した時点で、後続の走査を止める。 */
	get full(): boolean {
		return this.remaining === 0;
	}

	/** 文字列の上限と秘密値の除去を、JSON 生成前に適用する。 */
	string(value: string, secrets: readonly string[]): string {
		const result = privateDisplayText(value, 4 * 1024, secrets);
		this.omitted ||= result.omitted;
		return result.text;
	}

	/** 有限の断片だけを蓄積し、マルチバイト文字を途中で切らない。 */
	append(value: string): void {
		const text = displayPrefix(value, this.remaining);
		this.parts.push(text);
		this.remaining -= Buffer.byteLength(text, "utf8");
		if (text.length < value.length) {
			this.omitted = true;
			this.remaining = 0;
		}
	}

	/** 非公開情報や上限による省略があれば、その事実を本文へ残す。 */
	finish(): string {
		return this.parts.join("") + (this.omitted ? omission : "");
	}
}

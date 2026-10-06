// 出力の境界をまたぐ秘密値を保持し、伏字にしてから逐次通知する。
import type { SecretRedactor } from "./CredentialStore";
/** 秘密値の最大長を基に末尾を留保し、重なる一致区間もまとめて保持する。 */
export class CredentialStream {
	private pending = "";
	constructor(
		private readonly redactor: SecretRedactor,
		private readonly emit: (text: string) => void,
	) {}
	write(chunk: string) {
		this.pending += chunk;
		const variants = this.redactor.variants();
		let boundary = Math.max(
			0,
			this.pending.length -
				Math.max(0, ...variants.map((value) => value.length - 1)),
		);
		// 一致区間を先に統合するため、後の一致で境界が戻っても秘密値の途中にならない。
		for (const range of this.redactor.ranges(this.pending)) {
			if (range.start < boundary && range.end > boundary) {
				boundary = range.start;
			}
		}
		this.publish(boundary);
	}
	end() {
		this.publish(this.pending.length);
	}
	private publish(boundary: number) {
		if (!boundary) {
			return;
		}
		const text = this.redactor.text(this.pending.slice(0, boundary));
		this.pending = this.pending.slice(boundary);
		if (text) {
			this.emit(text);
		}
	}
}

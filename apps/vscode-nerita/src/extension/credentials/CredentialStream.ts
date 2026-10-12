// 出力の境界をまたぐ秘密値を保持し、伏字にしてから逐次通知する。
import { isNonZeroNumber } from "@nerita/shared/valuePredicates";
import type { SecretRedactor } from "./CredentialStore";
/** 秘密値の最大長を基に末尾を留保し、重なる一致区間もまとめて保持する。 */
export class CredentialStream {
	private pending = "";
	/** 分割された出力にも同じ秘密除去を適用し、公開先へ送る前に処理する。 */
	constructor(
		private readonly redactor: SecretRedactor,
		private readonly emit: (text: string) => void,
	) {}
	/** 秘密値がチャンク境界をまたいでも伏字にできるよう、末尾の候補文字列を次の出力まで保持する。 */
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
	/** 出力の終了時にも伏字処理を通して、保留した末尾を公開する。 */
	end() {
		this.publish(this.pending.length);
	}
	/** 確定した範囲だけを保護して公開し、未確定の末尾は次のチャンクへ残す。 */
	private publish(boundary: number) {
		if (!isNonZeroNumber(boundary)) {
			return;
		}
		const text = this.redactor.text(this.pending.slice(0, boundary));
		this.pending = this.pending.slice(boundary);
		if (text !== "") {
			this.emit(text);
		}
	}
}

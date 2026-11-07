// 登録辞書を使わず、メール・電話・カード番号と項目名を伴う識別番号を検査する。
import type { PrivacyKind } from "@nerita/shared/guardrails/privacy";

/** カード番号らしい桁数でも、同じ数字の繰り返しや Luhn 不一致は候補から除く。 */
function isCardNumber(value: string): boolean {
	const digits = value.replace(/\D/g, "");
	if (!/^[3-6]\d{12,18}$/.test(digits) || /^(\d)\1+$/.test(digits)) {
		return false;
	}
	let sum = 0;
	for (let index = digits.length - 1; index >= 0; index--) {
		let digit = Number(digits[index]);
		if ((digits.length - index) % 2 === 0) {
			digit *= 2;
			if (digit > 9) {
				digit -= 9;
			}
		}
		sum += digit;
	}
	return sum % 10 === 0;
}

/** 国内の固定・携帯・フリーダイヤルと、国番号を明示した国際電話を対象にする。 */
function hasPhoneNumber(text: string): boolean {
	const domestic = text.matchAll(/\b0(?:[ ()-]{0,3}\d){9,10}\b/g);
	for (const [candidate] of domestic) {
		const digits = candidate.replace(/\D/g, "");
		if (/^0(?:[1-9]\d{8}|[5789]0\d{8})$/.test(digits)) {
			return true;
		}
	}
	return /\B\+[1-9](?:[ ()-]{0,3}\d){7,14}\b/.test(text);
}

/** 数字だけの日時やバージョンを広く拾わないよう、番号の名称を手掛かりにする。 */
function hasLabeledIdentifier(text: string): boolean {
	const twelveDigits =
		/(?:マイナンバー|個人番号|運転免許証?番号|my[_ -]?number|driver[_ -]?licen[cs]e(?:[_ -]?number)?)[\s:：="'#-]{0,12}(?:\d[ -]?){11}\d(?!\d)/i;
	const passport =
		/(?:旅券番号|パスポート番号|passport(?:[_ -]?(?:number|no))?)[\s:：="'#-]{0,12}[a-z]{1,2}\d{7,8}(?![a-z\d])/i;
	const labels =
		/(?:口座番号|保険証番号|被保険者(?:記号|番号)|保険者番号|社員番号|従業員番号|学籍番号|(?:bank[_ -]?account|employee|student|insurance|social[_ -]?security)[_ -]?(?:id|number|no)|\bssn\b)[\s:：="'#-]{0,12}([a-z\d][a-z\d -]{1,30}[a-z\d])(?![a-z\d])/gi;
	return (
		twelveDigits.test(text) ||
		passport.test(text) ||
		[...text.matchAll(labels)].some((match) => /\d/.test(match[1]!))
	);
}

/** 返すのは分類のみ。入力・検出値・一致位置は保持しない。 */
export function detectPrivacyPatterns(value: string): PrivacyKind[] {
	const text = value.normalize("NFKC").replace(/[‐‑‒–—―−]/g, "-");
	const kinds: PrivacyKind[] = [];
	const email =
		/[\w.!#$%&'*+/=?^`{|}~-]{1,64}@[\p{L}\d][\p{L}\d.-]{0,252}\.\p{L}{2,63}/u.test(
			text,
		);
	if (email) {
		kinds.push("email");
	}
	if (hasPhoneNumber(text)) {
		kinds.push("phone");
	}
	const cards = text.matchAll(/\b(?:\d[ -]?){12,18}\d\b/g);
	const identifier =
		hasLabeledIdentifier(text) ||
		[...cards].some(([candidate]) => isCardNumber(candidate));
	if (identifier) {
		kinds.push("identifier");
	}
	return kinds;
}

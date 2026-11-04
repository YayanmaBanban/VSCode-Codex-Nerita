// 外部ブラウザーで開く URL の許可条件を、Webview と Host の入口で共有する。

/** 絶対 HTTP/HTTPS URL だけを許可し、制御文字や別アプリを起動するスキームを拒否する。 */
export function isBrowserUrl(value: unknown): value is string {
	if (typeof value !== "string" || !/^https?:\/\//i.test(value)) {
		return false;
	}
	const containsControl = Array.from(value).some(
		(character) =>
			character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
	);
	if (containsControl) {
		return false;
	}
	return /^https?:\/\/[^/?#\\]+(?:[/?#][^\\]*)?$/i.test(value);
}

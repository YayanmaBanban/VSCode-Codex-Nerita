// 最終更新日時を現在からの経過時間として表示する。
/** 日付が省略・不正な場合も安全な表示を返す。 */
export function relativeTime(
	updatedAt: string | undefined,
	now: number,
): string {
	const timestamp = Date.parse(updatedAt ?? "");
	if (!Number.isFinite(timestamp)) {
		return "更新日時不明";
	}
	const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
	if (seconds < 60) {
		return "たった今";
	}
	if (seconds < 3600) {
		return `${Math.floor(seconds / 60)}分前`;
	}
	if (seconds < 86400) {
		return `${Math.floor(seconds / 3600)}時間前`;
	}
	if (seconds < 2592000) {
		return `${Math.floor(seconds / 86400)}日前`;
	}
	if (seconds < 31536000) {
		return `${Math.floor(seconds / 2592000)}か月前`;
	}
	return `${Math.floor(seconds / 31536000)}年前`;
}

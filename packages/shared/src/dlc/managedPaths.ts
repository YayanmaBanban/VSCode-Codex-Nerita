// 管理ファイルと利用者が採用した Markdown の境界を、収集と編集制限で共有する。
export function isDlcPath(path: string): boolean {
	return path.toLowerCase().startsWith(".nerita/dlc/");
}
export function isDlcKnowledge(path: string): boolean {
	const normalized = path.toLowerCase();
	return (
		normalized.endsWith(".md") &&
		/^\.nerita\/dlc\/spaces\/default\/(?:memory\/|knowledge\/|intents\/[^/]+\/artifacts\/)/u.test(
			normalized,
		)
	);
}
export function isManagedDlcPath(path: string): boolean {
	return isDlcPath(path) && !isDlcKnowledge(path);
}

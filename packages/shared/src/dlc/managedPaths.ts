// 管理ファイルと利用者が採用した Markdown の境界を、収集と編集制限で共有する。
export function isDlcPath(path: string): boolean {
	return path.toLowerCase().startsWith(".nerita/dlc/");
}
/** DLC の知識として扱う Markdown の相対パスを判定する。入力は `/` 区切りのワークスペース相対パスとする。 */
export function isDlcKnowledge(path: string): boolean {
	const normalized = path.toLowerCase();
	return (
		normalized.endsWith(".md") &&
		/^\.nerita\/dlc\/spaces\/default\/(?:memory\/|knowledge\/|intents\/[^/]+\/artifacts\/)/u.test(
			normalized,
		)
	);
}
/** 利用者の知識ファイルを除いた DLC 管理領域を判定する。入力は `/` 区切りのワークスペース相対パスとする。 */
export function isManagedDlcPath(path: string): boolean {
	return isDlcPath(path) && !isDlcKnowledge(path);
}

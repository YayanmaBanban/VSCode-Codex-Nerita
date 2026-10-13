// リソース権限の有効範囲と、許可・再実行操作の表示文言を定義する。

/** リソース権限の有効範囲を、管理画面の表示名へ変換する。 */
export const scopeLabels = {
	process: "今回の再実行",
	session: "セッション中",
	workspace: "このワークスペース",
};
/** 許可の有効範囲ごとに、許可と再実行を案内するボタン文言を定義する。 */
export const allowLabels = {
	process: "今回だけ許可して再実行",
	session: "セッション中許可して再実行",
	workspace: "このワークスペースで許可して再実行",
};

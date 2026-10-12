// 表示用の型と文書変換を共有し、各入力欄では状態を複製しない。

/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export const scopeLabels = {
	process: "今回の再実行",
	session: "セッション中",
	workspace: "このワークスペース",
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export const allowLabels = {
	process: "今回だけ許可して再実行",
	session: "セッション中許可して再実行",
	workspace: "このワークスペースで許可して再実行",
};

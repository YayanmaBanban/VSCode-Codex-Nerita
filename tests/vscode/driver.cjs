// 画面の確認ダイアログを有効にしたまま受け入れ検証を起動し、終了結果を親プロセスへ返す。
const fs = require("node:fs/promises");
const vscode = require("vscode");

/** アサーション失敗を結果ファイルに残し、この検証用ウィンドウを閉じる。 */
async function activate() {
	let result;
	try {
		await require(process.env.NERITA_UI_ENTRY).run();
		result = { passed: true };
	} catch (error) {
		result = { passed: false, error: String(error.stack ?? error) };
	} finally {
		await fs.writeFile(
			process.env.NERITA_UI_RESULT,
			JSON.stringify(result),
		);
		await vscode.commands.executeCommand("workbench.action.quit");
	}
}

module.exports = { activate };

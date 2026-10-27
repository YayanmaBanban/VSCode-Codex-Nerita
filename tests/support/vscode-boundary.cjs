// ローカル検証では各テストが必要な VS Code API だけを設定し、未設定の呼び出しは失敗させる。
module.exports = {
	Uri: {},
	Range: class {
		/** 文書 API に渡す座標を保持し、実際の範囲照合と同じ値の契約を使う。 */
		constructor(startLine, startCharacter, endLine, endCharacter) {
			this.start = { line: startLine, character: startCharacter };
			this.end = { line: endLine, character: endCharacter };
			this.isEmpty =
				startLine === endLine && startCharacter === endCharacter;
		}
	},
	workspace: {},
	window: {},
	commands: {},
	env: {},
	ProgressLocation: {},
	languages: {},
	ConfigurationTarget: {},
	ViewColumn: {},
};

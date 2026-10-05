// ローカル検証では各テストが必要な VS Code API だけを設定し、未設定の呼び出しは失敗させる。
module.exports = {
	Uri: {},
	workspace: {},
	window: {},
	commands: {},
	env: {},
	ProgressLocation: {},
	languages: {},
	ConfigurationTarget: {},
};

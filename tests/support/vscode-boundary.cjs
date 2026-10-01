// ローカル検証ではエディター API を提供せず、誤って呼び出せば失敗させる。
module.exports = {
	workspace: {},
	window: {},
	commands: {},
	env: {},
	ProgressLocation: {},
};

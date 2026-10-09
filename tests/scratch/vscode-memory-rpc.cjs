// 履歴復元の診断用に、実際の App Server の要求名と応答メタデータだけを観測する。
const childProcess = require("node:child_process");
const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");

/** データや応答は変更せず、復元失敗の理由を確認できるようにする。 */
function observeRpc(diagnostics) {
	const original = childProcess.spawn;
	childProcess.spawn = function (...arguments_) {
		const child = original.apply(this, arguments_);
		if (String(arguments_[0]).endsWith("codex.exe")) {
			observeChild(child, diagnostics);
		}
		return child;
	};
	return () => {
		childProcess.spawn = original;
	};
}

/** 全文出力は残さず、メソッドとエラー、復元時の作業場所を取り出す。 */
function observeChild(child, diagnostics) {
	const requests = new Map();
	const originalWrite = child.stdin.write.bind(child.stdin);
	child.stdin.write = (data, ...arguments_) => {
		const request = JSON.parse(data.toString());
		if (request.id !== undefined) {
			requests.set(request.id, request.method);
		}
		return originalWrite(data, ...arguments_);
	};
	readline.createInterface({ input: child.stdout }).on("line", (line) => {
		const response = JSON.parse(line);
		const method = requests.get(response.id);
		requests.delete(response.id);
		if (response.error) {
			diagnostics.push({ method, error: response.error });
		} else if (["thread/read", "thread/resume"].includes(method)) {
			const result = response.result;
			diagnostics.push({
				method,
				cwd: result.cwd,
				thread: {
					id: result.thread.id,
					cwd: result.thread.cwd,
					status: result.thread.status,
					historyMode: result.thread.historyMode,
				},
				modelProvider: result.modelProvider,
			});
		}
		fs.writeFileSync(
			path.join(process.env.NERITA_UI_ARTIFACTS, "rpc.json"),
			JSON.stringify(diagnostics, null, 2),
		);
	});
}

module.exports = { observeRpc };

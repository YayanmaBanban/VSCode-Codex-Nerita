// 狙った回帰だけを検証用バンドルへ注入し、製品ソースは書き換えない。
const fs = require("node:fs/promises");

const regressions = {
	"file-content-changed": {
		selection: "pi-effects",
		file: "FileSnapshot.ts",
		before: "JSON.stringify(current.file) !== JSON.stringify(snapshot.file)",
		after: "false",
		expected: [
			{
				test: "承認待ちの content 変更を拒否し、他の編集とリンク先の本文を保持する",
				messages: ["承認待ちの変更後は古い許可を拒否する"],
			},
		],
	},
	"pi-switch-disposes-current": {
		selection: "pi-storage",
		file: "PiLifecycle.ts",
		before: "if (previous) {\n\t\t\tthis.epoch++;",
		after: "if (previous) {\n\t\t\tthis.epoch++;\n\t\t\tthis.opening?.abort();",
		expected: [
			{
				test: "一覧取得後に履歴が破損しても現在の会話と元ファイルを保持する",
				messages: ["履歴切替に失敗した元会話でも送信を続行できる"],
			},
		],
	},
	"backend-save-accepts-prompt": {
		selection: "webview-backend",
		file: "chatViewProvider.ts",
		before: 'this.backendPending && value.type !== "prompt/cancel"',
		after: "false",
		expected: [
			{
				test: "バックエンド保存待ちの送信を拒否して下書きを保持し、保存失敗後は元会話へ送信できる",
				messages: ["保存待ちの送信を受理せず下書きを維持する"],
			},
		],
	},
	"sandbox-setup-no-wait": {
		expected: [
			{
				test: "Sandbox の開始受付を完了と扱わず、完了通知・失敗・接続取消しを区別する",
				messages: [
					"開始受付だけで完了表示してはいけない",
					"成功したセットアップの完了通知だけを表示する",
				],
			},
		],
		selection: "codex-conversation",
		file: "sandboxSetup.ts",
		before: "await finished;",
		after: "void finished;",
	},
	"settings-keeps-permit": {
		expected: [
			{
				test: "settings の後に古い許可を返してもファイルを作成しない",
				messages: ["取消し後の古い許可では書き込まない"],
			},
		],
		selection: "pi-effects",
		file: "GuardrailRegistry.ts",
		before: "this.entries\n\t\t\t.get(root)\n\t\t\t?.abort.abort(",
		after: "new Map<string, Entry>()\n\t\t\t.get(root)\n\t\t\t?.abort.abort(",
	},
	"handoff-raw-fallback": {
		expected: [
			{
				test: "保存した会話の原文とハンドオフを参照し、要約失敗では親へ送信しない",
				messages: ["要約失敗は原文へ代替せず通知する"],
			},
		],
		selection: "pi-conversation",
		file: "HandoffContext.ts",
		before: "throw new HandoffContextError();",
		after: "return source;",
	},
	"pi-stale-connection": {
		expected: [
			{
				test: "起動中に無効化した Pi 接続の遅い完了を公開せず、次の接続だけへ送信する",
				messages: ["無効化後の遅い接続を公開しない"],
			},
		],
		selection: "pi-conversation",
		file: "PiLifecycle.ts",
		before: "this.cancelQuota();\n\t\tthis.epoch++;",
		after: "this.cancelQuota();",
	},
	"moved-workspace-hidden": {
		expected: [
			{
				test: "送信した会話を別接続で復元し、フォーク後の送信で元ファイルを変更しない",
				messages: ["指定した保存履歴の ID で復元する"],
			},
		],
		selection: "pi-storage",
		file: "PiSessionStore.ts",
		before: 'storage === "workspace"\n\t\t\t\t? await sdk.SessionManager.listAll(',
		after: "false\n\t\t\t\t? await sdk.SessionManager.listAll(",
	},
	"codex-plan-not-completed": {
		expected: [
			{
				test: "Codex の設定を次の要求と再接続へ反映し、追加指示・計画・差分・停止を届ける",
				messages: ["終了済みターンの計画カードを実行中にしない"],
			},
		],
		selection: "codex-conversation",
		file: "CodexRun.ts",
		before: 'tool.id.startsWith("turn:")',
		after: 'tool.id.startsWith("missing:")',
	},
	"mcp-display-lost": {
		expected: ["structuredContent", "content"].map((source) => ({
			test: `MCP の ${source} と秘密除去・省略情報を保存後も保持する`,
			messages: ["MCP の表示元と省略情報を維持する"],
		})),
		selection: "pi-mcp",
		file: "PiResultDisplay.ts",
		before: "return { ...body, ...savedDisplay(result) };",
		after: "return body;",
	},
	"fork-overwrites-source": {
		expected: [
			{
				test: "送信した会話を別接続で復元し、フォーク後の送信で元ファイルを変更しない",
				messages: ["フォークは元と別の履歴 ID を使う"],
			},
		],
		selection: "pi-storage",
		file: "PiSessionStore.ts",
		before: "manager.createBranchedSession(leaf);",
		after: "void leaf;",
	},
	"duplicate-request": {
		expected: [
			{
				test: "許可前には書かず、許可後は一度だけ書く。重複要求を再実行しない",
				messages: ["同じ要求 ID を再実行しない"],
			},
		],
		selection: "pi-effects",
		file: "PiSessionController.ts",
		before: "if (this.seen.has(value.requestId))",
		after: "if (false)",
	},
	"broken-result": {
		expected: [
			...[
				[true, false],
				[false, true],
				[true, true],
			].map(([search, code]) => ({
				test: `通常ツールの大きな結果を保持する（検索=${search}、コード実行=${code}）`,
				messages: ["大きなツール結果の本文を切断せず範囲取得へ渡す"],
			})),
			{
				test: "コード実行の子の全文を別ファイルへ保存し、再接続とフォークで共有する",
				messages: ["子の大きな結果を JSON の途中で切断しない"],
			},
		],
		selection: "pi-results",
		file: "PiFeatureSafety.ts",
		before: "Number.POSITIVE_INFINITY",
		after: "262144",
	},
};

/** 通常版の後に同じ検証を使い、無関係な準備失敗を検出実績へ含めない。 */
function regressionPlugin(name) {
	const entry = regressions[name];
	if (!entry) {
		throw new Error(`未知の回帰: ${name}`);
	}
	let applied = false;
	return {
		name: "product-regression",
		setup(builder) {
			builder.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
				if (!path.endsWith(entry.file)) {
					return undefined;
				}
				const contents = (await fs.readFile(path, "utf8")).replaceAll(
					"\r\n",
					"\n",
				);
				if (contents.split(entry.before).length !== 2) {
					throw new Error(`回帰の注入箇所が変わっています: ${name}`);
				}
				applied = true;
				return {
					contents: contents.replace(entry.before, entry.after),
					loader: "ts",
				};
			});
			builder.onEnd(() => {
				if (!applied) {
					throw new Error(`回帰を注入できませんでした: ${name}`);
				}
			});
		},
	};
}
module.exports = { regressions, regressionPlugin };

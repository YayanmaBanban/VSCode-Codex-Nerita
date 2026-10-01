// 狙った回帰だけを検証用バンドルへ注入し、製品ソースは書き換えない。
const fs = require("node:fs/promises");

const regressions = {
	"sandbox-setup-no-wait": {
		selection: "codex-conversation",
		file: "sandboxSetup.ts",
		before: "await finished;",
		after: "void finished;",
	},
	"settings-keeps-permit": {
		selection: "pi-effects",
		file: "GuardrailRegistry.ts",
		before: "this.entries\n\t\t\t.get(root)\n\t\t\t?.abort.abort(",
		after: "new Map<string, Entry>()\n\t\t\t.get(root)\n\t\t\t?.abort.abort(",
	},
	"handoff-raw-fallback": {
		selection: "pi-conversation",
		file: "HandoffContext.ts",
		before: "throw new HandoffContextError();",
		after: "return source;",
	},
	"pi-stale-connection": {
		selection: "pi-conversation",
		file: "PiLifecycle.ts",
		before: "this.cancelQuota();\n\t\tthis.epoch++;",
		after: "this.cancelQuota();",
	},
	"moved-workspace-hidden": {
		selection: "pi-storage",
		file: "PiSessionStore.ts",
		before: 'storage === "workspace"\n\t\t\t\t? await sdk.SessionManager.listAll(',
		after: "false\n\t\t\t\t? await sdk.SessionManager.listAll(",
	},
	"codex-plan-not-completed": {
		selection: "codex-conversation",
		file: "CodexRun.ts",
		before: 'tool.id.startsWith("turn:")',
		after: 'tool.id.startsWith("missing:")',
	},
	"mcp-display-lost": {
		selection: "pi-mcp",
		file: "PiResultDisplay.ts",
		before: "return { ...body, ...savedDisplay(result) };",
		after: "return body;",
	},
	"fork-overwrites-source": {
		selection: "pi-storage",
		file: "PiSessionStore.ts",
		before: "manager.createBranchedSession(leaf);",
		after: "void leaf;",
	},
	"duplicate-request": {
		selection: "pi-effects",
		file: "PiSessionController.ts",
		before: "if (this.seen.has(value.requestId))",
		after: "if (false)",
	},
	"broken-result": {
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

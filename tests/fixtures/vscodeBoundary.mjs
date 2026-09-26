// VS Code 外の疎通テストでは、エディター API の誤用を成功扱いにしない。
export const vscodeBoundary = {
	name: "vscode-smoke-boundary",
	setup(builder) {
		builder.onResolve({ filter: /^vscode$/ }, () => ({
			path: "vscode",
			namespace: "vscode-smoke-boundary",
		}));
		builder.onLoad(
			{ filter: /.*/, namespace: "vscode-smoke-boundary" },
			() => ({
				contents: "module.exports = { workspace: {}, window: {} };",
				loader: "js",
			}),
		);
	},
};

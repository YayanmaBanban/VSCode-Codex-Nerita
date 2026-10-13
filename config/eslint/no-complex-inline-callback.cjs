// 呼び出し引数に埋め込む処理の量・分岐の深さ・非同期処理の重なりを検査する。
const { walk, isFunction, isInlineCallback } = require("./ast.cjs");

const controls = new Set([
	"IfStatement",
	"ForStatement",
	"ForInStatement",
	"ForOfStatement",
	"WhileStatement",
	"DoWhileStatement",
	"SwitchStatement",
	"TryStatement",
]);

/** 内部の別関数は別の検査単位とし、コールバック自身が実行する処理を数える。 */
function measure(body, visitorKeys) {
	const result = { statements: 0, controls: 0, depth: 0, awaits: 0 };
	walk(body, visitorKeys, (node) => {
		if (isFunction(node)) {
			return false;
		}
		if (node.type.endsWith("Statement") && node.type !== "BlockStatement") {
			result.statements += 1;
		}
		if (node.type === "VariableDeclaration") {
			result.statements += 1;
		}
		if (node.type === "AwaitExpression") {
			result.awaits += 1;
		}
		if (!controls.has(node.type)) {
			return;
		}
		result.controls += 1;
		let depth = 1;
		for (
			let parent = node.parent;
			parent && parent !== body;
			parent = parent.parent
		) {
			if (controls.has(parent.type)) {
				depth += 1;
			}
		}
		result.depth = Math.max(result.depth, depth);
	});
	return result;
}

module.exports = {
	meta: {
		type: "suggestion",
		schema: [
			{
				type: "object",
				properties: {
					maxStatements: { type: "integer", minimum: 1 },
					maxControlDepth: { type: "integer", minimum: 1 },
					maxAwaits: { type: "integer", minimum: 1 },
				},
				additionalProperties: false,
			},
		],
		messages: {
			separate:
				"処理の多いインラインコールバックを、名前付き関数または変数へ分離してください（文 {{statements}}、制御フローの深さ {{depth}}、await {{awaits}}）。",
		},
	},
	create(context) {
		const options = context.options[0] ?? {};
		const maxStatements = options.maxStatements ?? 8;
		const maxControlDepth = options.maxControlDepth ?? 2;
		const maxAwaits = options.maxAwaits ?? 2;
		/** 非同期の取得と複数のガードが交互に並ぶ処理も、独立した責務として切り出す。 */
		function check(node) {
			if (!isInlineCallback(node)) {
				return;
			}
			const result = measure(node.body, context.sourceCode.visitorKeys);
			const asynchronousGuards =
				result.awaits >= 2 && result.controls >= 2;
			const largeControlFlow =
				result.statements > maxStatements ||
				result.depth > maxControlDepth;
			if (
				largeControlFlow ||
				result.awaits > maxAwaits ||
				asynchronousGuards
			) {
				context.report({ node, messageId: "separate", data: result });
			}
		}
		return { ArrowFunctionExpression: check, FunctionExpression: check };
	},
};

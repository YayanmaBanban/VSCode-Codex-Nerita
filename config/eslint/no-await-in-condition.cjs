// 条件を評価する await を検出し、別関数内部の await は条件に結び付けない。
const { walk, isFunction } = require("./ast.cjs");

module.exports = {
	meta: {
		type: "suggestion",
		schema: [],
		messages: {
			separate:
				"条件式内の await を分離し、評価済みの値で判定してください。短絡評価とループごとの評価順序を維持してください。",
		},
	},
	create(context) {
		const reported = new WeakSet();
		/** 条件に含まれる await の位置を示す。ループの更新式や本体は対象にしない。 */
		function check(node) {
			walk(node.test, context.sourceCode.visitorKeys, (child) => {
				if (isFunction(child)) {
					return false;
				}
				if (child.type === "AwaitExpression" && !reported.has(child)) {
					reported.add(child);
					context.report({ node: child, messageId: "separate" });
				}
			});
		}
		return {
			IfStatement: check,
			WhileStatement: check,
			DoWhileStatement: check,
			ForStatement: check,
			ConditionalExpression: check,
		};
	},
};

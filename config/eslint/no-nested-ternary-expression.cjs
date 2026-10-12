// 分岐のオブジェクト・配列・直接渡すコールバックを含めて、三項演算子のネストを検査する。
const { walk, isFunction, isDirectCallback } = require("./ast.cjs");

/** 関数を値として保存する分岐は独立した処理であり、外側のネストに数えない。 */
function nestedInBranch(branch, visitorKeys) {
	let nested = false;
	walk(branch, visitorKeys, (node) => {
		if (isFunction(node) && !isDirectCallback(node)) {
			return false;
		}
		if (node.type === "ConditionalExpression") {
			nested = true;
			return false;
		}
	});
	return nested;
}

/** 分岐内の三項演算子は外側でまとめて報告し、条件側の式は独立して検査する。 */
function hasBranchAncestor(node) {
	let child = node;
	for (let parent = node.parent; parent; parent = parent.parent) {
		if (isFunction(parent) && !isDirectCallback(parent)) {
			return false;
		}
		if (parent.type === "ConditionalExpression" && child !== parent.test) {
			return true;
		}
		child = parent;
	}
	return false;
}

module.exports = {
	meta: {
		type: "suggestion",
		schema: [],
		messages: {
			separate:
				"三項演算子の分岐内に別の三項演算子があります。コールバックを含む分岐の処理を、if 文または名前付き関数へ分離してください。",
		},
	},
	create(context) {
		return {
			ConditionalExpression(node) {
				if (hasBranchAncestor(node)) {
					return;
				}
				const keys = context.sourceCode.visitorKeys;
				if (
					nestedInBranch(node.consequent, keys) ||
					nestedInBranch(node.alternate, keys)
				) {
					context.report({ node, messageId: "separate" });
				}
			},
		};
	},
};

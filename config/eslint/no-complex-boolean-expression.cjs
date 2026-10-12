// 論理演算だけでなく、コールバックや呼び出しの重なりを持つ式を検査する。
const { walk, isFunction, isWrapper, isDirectCallback } = require("./ast.cjs");

/** JSX の表示条件を、外側の真偽値式と合算しない。 */
function isJsxData(node) {
	return node?.type === "JSXElement" || node?.type === "JSXFragment";
}

/** 注釈や否定を除き、点数を報告する元の論理式を取り出す。 */
function logicalRoot(node) {
	let expression = node;
	while (expression) {
		if (isWrapper(expression)) {
			expression = expression.expression;
		} else if (
			expression.type === "UnaryExpression" &&
			expression.operator === "!"
		) {
			expression = expression.argument;
		} else {
			break;
		}
	}
	return expression;
}

/** 述語内の別関数を除き、複数の判定を組み合わせているか確認する。 */
function hasBooleanLogic(body, visitorKeys) {
	let compound = false;
	walk(body, visitorKeys, (node) => {
		if (isFunction(node) || isJsxData(node)) {
			return false;
		}
		if (node.type === "LogicalExpression" && node.operator !== "??") {
			compound = true;
		}
	});
	return compound;
}

/** 配列検証のコールバックに複合判定を埋め込む構造を、条件式と戻り値で検出する。 */
function hasCompoundPredicate(expression, visitorKeys) {
	let compound = false;
	walk(expression, visitorKeys, (node) => {
		if (isFunction(node) || isJsxData(node)) {
			return false;
		}
		if (
			node.type !== "CallExpression" ||
			!["every", "some"].includes(node.callee.property?.name)
		) {
			return;
		}
		for (const argument of node.arguments) {
			const callback = logicalRoot(argument);
			if (
				isFunction(callback) &&
				hasBooleanLogic(callback.body, visitorKeys)
			) {
				compound = true;
			}
		}
	});
	return compound;
}

/** && と || が切り替わる判定に呼び出しも重なる場合、評価する責務を分ける。 */
function hasMixedValidation(expression, visitorKeys) {
	const operators = new Set();
	let calls = false;
	walk(expression, visitorKeys, (node) => {
		if (isFunction(node) || isJsxData(node)) {
			return false;
		}
		if (node.type === "LogicalExpression" && node.operator !== "??") {
			operators.add(node.operator);
		}
		if (node.type === "CallExpression") {
			calls = true;
		}
	});
	return operators.size > 1 && calls;
}

/** 報告済みの条件式に含まれる式はまとめ、別の名前付き関数は独立して検査する。 */
function wasReported(node, reported) {
	for (let parent = node; parent; parent = parent.parent) {
		if (isJsxData(parent)) {
			return false;
		}
		if (reported.has(parent)) {
			return true;
		}
		if (isFunction(parent) && !isDirectCallback(parent)) {
			return false;
		}
	}
	return false;
}

/** 同じ評価式を二重報告せず、無関係な関数の式は独立して検査する。 */
function hasLogicalAncestor(node) {
	for (let parent = node.parent; parent; parent = parent.parent) {
		if (isJsxData(parent)) {
			return false;
		}
		if (isFunction(parent) && !isDirectCallback(parent)) {
			return false;
		}
		if (parent.type === "LogicalExpression" && parent.operator !== "??") {
			return true;
		}
	}
	return false;
}

/** 別関数の呼び出しと混ぜず、同じ評価単位で重なる呼び出しを数える。 */
function nestedCallDepth(node, root) {
	let depth = 1;
	for (
		let parent = node.parent;
		parent && parent !== root.parent;
		parent = parent.parent
	) {
		if (isFunction(parent)) {
			break;
		}
		if (parent.type === "CallExpression") {
			depth += 1;
		}
	}
	return depth;
}

/** 型検証の単純な列挙を許可し、複数の構造を組み合わせた式だけを採点する。 */
function measure(node, visitorKeys) {
	let logical = 0;
	let callbacks = 0;
	let collections = 0;
	let callDepth = 0;
	walk(node, visitorKeys, (child) => {
		if (isJsxData(child)) {
			return false;
		}
		if (isFunction(child)) {
			if (!isDirectCallback(child)) {
				return false;
			}
			callbacks += 1;
		}
		if (child.type === "LogicalExpression" && child.operator !== "??") {
			logical += 1;
		}
		if (child.type !== "CallExpression") {
			return;
		}
		if (["every", "some"].includes(child.callee.property?.name)) {
			collections += 1;
		}
		callDepth = Math.max(callDepth, nestedCallDepth(child, node));
	});
	const structured = callbacks > 0 || collections > 1 || callDepth > 1;
	return {
		structured,
		score: logical + callbacks * 2 + Math.max(0, callDepth - 1) * 2,
	};
}

module.exports = {
	meta: {
		type: "suggestion",
		schema: [
			{
				type: "object",
				properties: { maxScore: { type: "integer", minimum: 0 } },
				additionalProperties: false,
			},
		],
		messages: {
			separate:
				"論理演算とコールバック・呼び出しが重なる式を、早期 return または名前付きの述語へ分離してください（複雑さ {{score}}、上限 {{max}}）。",
			predicate:
				"if の条件式・return の式に、複合条件を持つ配列検証を埋め込まないでください。検証結果を先に評価するか、名前付きの述語へ分離してください。",
			mixed: "if の条件式・return の式で、&& と || を組み合わせた検証呼び出しを分離してください。短絡評価を保ちながら、検証結果を先に評価するか早期 return で段階的に判定してください。",
		},
	},
	create(context) {
		const max = context.options[0]?.maxScore ?? 6;
		const keys = context.sourceCode.visitorKeys;
		const reported = new WeakSet();
		/** 従来の点数による診断位置を維持し、追加の構造条件との二重報告を防ぐ。 */
		function reportScore(node) {
			if (node?.type !== "LogicalExpression") {
				return false;
			}
			const result = measure(node, keys);
			if (!result.structured || result.score <= max) {
				return false;
			}
			reported.add(node);
			context.report({
				node,
				messageId: "separate",
				data: { score: result.score, max },
			});
			return true;
		}
		/** 条件式・戻り値は、低い点数でも検証の責務が重なる構造を切り出す。 */
		function checkExpression(node) {
			if (!node || wasReported(node, reported)) {
				return;
			}
			if (reportScore(logicalRoot(node))) {
				return;
			}
			let messageId;
			if (hasCompoundPredicate(node, keys)) {
				messageId = "predicate";
			} else if (hasMixedValidation(node, keys)) {
				messageId = "mixed";
			} else {
				return;
			}
			reported.add(node);
			context.report({ node, messageId });
		}
		return {
			IfStatement(node) {
				checkExpression(node.test);
			},
			ReturnStatement(node) {
				const root = logicalRoot(node.argument);
				// データを組み立てる戻り値は、全体を一つの真偽値式として扱わない。
				if (
					root?.type === "ObjectExpression" ||
					root?.type === "ArrayExpression" ||
					isJsxData(root)
				) {
					return;
				}
				checkExpression(node.argument);
			},
			LogicalExpression(node) {
				if (
					node.operator === "??" ||
					hasLogicalAncestor(node) ||
					wasReported(node, reported)
				) {
					return;
				}
				reportScore(node);
			},
		};
	},
};

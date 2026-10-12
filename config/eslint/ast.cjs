// パーサーの visitorKeys を使い、親リンクや型情報を誤って走査しない。

/** 関数内部へ入るかどうかは、呼び出し側が検査の責務に応じて決める。 */
function walk(node, visitorKeys, enter) {
	if (!node || enter(node) === false) {
		return;
	}
	for (const key of visitorKeys[node.type] ?? []) {
		const child = node[key];
		if (Array.isArray(child)) {
			for (const item of child) {
				walk(item, visitorKeys, enter);
			}
		} else {
			walk(child, visitorKeys, enter);
		}
	}
}

/** 宣言・メソッドも含め、別の実行単位へ踏み込む境界を判定する。 */
function isFunction(node) {
	return [
		"ArrowFunctionExpression",
		"FunctionExpression",
		"FunctionDeclaration",
	].includes(node.type);
}

/** TypeScript の注釈・括弧相当のラッパーは、式の構造を変えない。 */
function isWrapper(node) {
	return [
		"TSAsExpression",
		"TSTypeAssertion",
		"TSNonNullExpression",
		"TSSatisfiesExpression",
		"ChainExpression",
	].includes(node.type);
}

/** 型注釈で包まれた関数も、直接渡す引数として扱う。 */
function isDirectCallback(node) {
	let argument = node;
	while (argument.parent && isWrapper(argument.parent)) {
		argument = argument.parent;
	}
	const parent = argument.parent;
	return (
		(parent?.type === "CallExpression" ||
			parent?.type === "NewExpression") &&
		parent.arguments.includes(argument)
	);
}

/** 配列・型注釈・三項演算子の分岐は、引数として渡す関数を包むことがある。 */
function isCallbackContainer(node, argument) {
	if (node.type === "ConditionalExpression") {
		return node.test !== argument;
	}
	return isWrapper(node) || node.type === "ArrayExpression";
}

/** オブジェクト・配列・分岐で渡すコールバックも検査し、アクセサーは対象にしない。 */
function isInlineCallback(node) {
	let argument = node;
	while (argument.parent) {
		const parent = argument.parent;
		if (isCallbackContainer(parent, argument)) {
			argument = parent;
			continue;
		}
		if (parent.type === "Property" && parent.value === argument) {
			if (parent.kind !== "init") {
				return false;
			}
			argument = parent.parent;
			continue;
		}
		return (
			(parent.type === "CallExpression" ||
				parent.type === "NewExpression") &&
			parent.arguments.includes(argument)
		);
	}
	return false;
}

module.exports = {
	walk,
	isFunction,
	isWrapper,
	isDirectCallback,
	isInlineCallback,
};

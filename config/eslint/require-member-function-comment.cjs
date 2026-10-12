// クラスのメンバ関数には、役割や制約を説明する宣言直前のコメントを必須にする。
const { isWrapper } = require("./ast.cjs");

/** 通常のメソッドと、TypeScript の抽象メソッド・オーバーロード宣言を扱う。 */
function isMethod(node) {
	return (
		node?.type === "MethodDefinition" ||
		node?.type === "TSAbstractMethodDefinition"
	);
}

/** 同じ名前でも static・アクセサー・computed の違うメンバへ説明を流用しない。 */
function sameMethod(left, right, sourceCode) {
	const sameKind = left.kind === right.kind && left.static === right.static;
	const sameKey =
		left.computed === right.computed &&
		sourceCode.getText(left.key) === sourceCode.getText(right.key);
	return isMethod(left) && sameKind && sameKey;
}

/** 連続するオーバーロード宣言と実装は、一つの説明と一つの診断で扱う。 */
function methodGroup(node, sourceCode) {
	const members = node.parent.body;
	let first = members.indexOf(node);
	while (first > 0) {
		const previous = members[first - 1];
		if (!isMethod(previous) || previous.value.body) {
			break;
		}
		if (!sameMethod(previous, node, sourceCode)) {
			break;
		}
		first -= 1;
	}
	let last = first;
	while (!members[last].value.body) {
		const next = members[last + 1];
		if (!isMethod(next) || !sameMethod(next, node, sourceCode)) {
			break;
		}
		last += 1;
	}
	return members.slice(first, last + 1);
}

/** 型注釈で包まれた、クラスフィールドの関数初期化もメンバ関数として扱う。 */
function isFunctionField(node) {
	let value = node.value;
	while (value && isWrapper(value)) {
		value = value.expression;
	}
	return (
		value?.type === "ArrowFunctionExpression" ||
		value?.type === "FunctionExpression"
	);
}

/** 空のコメントや解析指示だけでは、メンバの説明が存在することにしない。 */
function hasDescription(comment) {
	const text = comment.value.replaceAll("*", "").trim();
	return (
		text.length > 0 &&
		!/^(?:eslint(?:-|\s|$)|@ts-(?:ignore|expect-error|nocheck|check)\b)/u.test(
			text,
		)
	);
}

/** 前のメンバの行末コメントや、離れた節見出しをメソッドの説明として扱わない。 */
function documented(node, sourceCode) {
	const declaration = node.decorators?.[0] ?? node;
	return sourceCode.getCommentsBefore(declaration).some((comment) => {
		if (!hasDescription(comment)) {
			return false;
		}
		const gap = declaration.loc.start.line - comment.loc.end.line;
		if (gap < 0 || gap > 1) {
			return false;
		}
		const previous = sourceCode.getTokenBefore(comment);
		if (previous?.loc.end.line === comment.loc.start.line) {
			return previous.value === "{";
		}
		return true;
	});
}

module.exports = {
	meta: {
		type: "suggestion",
		schema: [],
		messages: {
			document:
				"メンバ関数 {{name}} の宣言直前に、役割・理由・制約を説明するコメントを追加してください。",
		},
	},
	create(context) {
		const sourceCode = context.sourceCode;
		/** 関数本体内のコメントでは、呼び出し側に伝える説明を代替しない。 */
		function check(node) {
			let group = [node];
			if (isMethod(node)) {
				group = methodGroup(node, sourceCode);
				if (group[0] !== node) {
					return;
				}
			} else if (!isFunctionField(node)) {
				return;
			}
			if (group.some((member) => documented(member, sourceCode))) {
				return;
			}
			let name = sourceCode.getText(node.key);
			if (node.computed) {
				name = `[${name}]`;
			}
			context.report({
				node: node.key,
				messageId: "document",
				data: { name },
			});
		}
		return {
			MethodDefinition: check,
			TSAbstractMethodDefinition: check,
			PropertyDefinition: check,
		};
	},
};

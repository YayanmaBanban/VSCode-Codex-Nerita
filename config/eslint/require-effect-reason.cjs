// Svelte の effect を使う理由が、登録箇所から読めることを確認する。

/** 観測用 API は含めず、副作用を登録する3つの rune を検査する。 */
function effectName(callee) {
	if (callee.type === "Identifier" && callee.name === "$effect") {
		return "$effect";
	}
	if (callee.type !== "MemberExpression" || callee.computed) {
		return null;
	}
	if (
		callee.object.type !== "Identifier" ||
		callee.object.name !== "$effect"
	) {
		return null;
	}
	const effectMethod =
		callee.property.type === "Identifier" &&
		["pre", "root"].includes(callee.property.name);
	return effectMethod ? `$effect.${callee.property.name}` : null;
}

/** 同じ名前の通常の関数・引数・import を、Svelte の rune と誤認しない。 */
function isShadowed(node, sourceCode) {
	let scope = sourceCode.getScope(node);
	while (scope) {
		const variable = scope.set.get("$effect");
		if (variable) {
			return variable.defs.length > 0;
		}
		scope = scope.upper;
	}
	return false;
}

/** root の解除関数を保存する宣言や return でも、直前の説明を参照する。 */
function commentAnchor(node) {
	let current = node;
	while (current.parent) {
		const statement =
			current.type.endsWith("Statement") ||
			current.type === "VariableDeclaration" ||
			current.type === "PropertyDefinition";
		if (statement) {
			return current.parent.type === "ExportNamedDeclaration"
				? current.parent
				: current;
		}
		if (current.parent.type === "ArrowFunctionExpression") {
			return node;
		}
		current = current.parent;
	}
	return node;
}

/** 空コメントや解析指示、rune 名の言い換えだけでは理由の説明にならない。 */
function describesReason(comment) {
	const text = comment.value.replace(/^\s*\*/gmu, "").trim();
	const directive =
		/^(?:eslint(?:-|\s|$)|@ts-(?:ignore|expect-error|nocheck|check)\b)/u;
	const labelOnly = /^\$effect(?:\.(?:pre|root))?(?:\(\))?\s*[:：]?$/u;
	return text.length > 0 && !directive.test(text) && !labelOnly.test(text);
}

/** 離れた見出しや、前の処理に付いた行末コメントを流用しない。 */
function documented(node, sourceCode) {
	const anchor = commentAnchor(node);
	return sourceCode.getCommentsBefore(anchor).some((comment) => {
		if (!describesReason(comment)) {
			return false;
		}
		const gap = anchor.loc.start.line - comment.loc.end.line;
		if (gap < 0 || gap > 1) {
			return false;
		}
		const previous = sourceCode.getTokenBefore(comment);
		return (
			previous?.loc.end.line !== comment.loc.start.line ||
			previous.value === "{"
		);
	});
}

module.exports = {
	meta: {
		type: "suggestion",
		schema: [],
		messages: {
			document:
				"{{name}} の直前に、$derived やイベント処理では扱えない副作用と、effect が必要な理由を説明するコメントを追加してください。",
		},
	},
	create(context) {
		const sourceCode = context.sourceCode;
		return {
			CallExpression(node) {
				const name = effectName(node.callee);
				if (!name || isShadowed(node, sourceCode)) {
					return;
				}
				if (documented(node, sourceCode)) {
					return;
				}
				context.report({
					node: node.callee,
					messageId: "document",
					data: { name },
				});
			},
		};
	},
};

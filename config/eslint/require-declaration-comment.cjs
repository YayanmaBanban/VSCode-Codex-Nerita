// 関数・型・クラスの説明を必須にし、公開する宣言には利用側の前提を案内する。
const { isWrapper, walk } = require("./ast.cjs");

/** 宣言の直前に置くコメントは、export と装飾子も含めた位置から探す。 */
function commentAnchor(node) {
	let anchor = node;
	if (node.type === "VariableDeclarator") {
		anchor = node.parent;
	}
	if (
		["ExportNamedDeclaration", "ExportDefaultDeclaration"].includes(
			anchor.parent?.type,
		)
	) {
		anchor = anchor.parent;
	}
	const decorator = node.decorators?.[0];
	return decorator && decorator.range[0] < anchor.range[0]
		? decorator
		: anchor;
}

/** 空コメント・解析指示・型注釈だけでは、役割や利用条件の説明として扱わない。 */
function hasDescription(comment) {
	const directive =
		/^(?:eslint(?:-|\s|$)|@ts-(?:ignore|expect-error|nocheck|check)\b|prettier-ignore\b|svelte-ignore\b|(?:istanbul|c8)\s+ignore\b|<reference\b|@(?:type|license|copyright)\b|SPDX-License-Identifier\b)/u;
	return comment.value.split(/\r?\n/u).some((line) => {
		const text = line.replace(/^\s*[*/]+/u, "").trim();
		return /[\p{L}\p{N}]/u.test(text) && !directive.test(text);
	});
}

/** 本体内・行末・離れた見出しのコメントを、宣言の説明へ流用しない。 */
function documented(node, sourceCode, htmlComments) {
	const anchor = commentAnchor(node);
	if (anchor.type === "SvelteConstTag") {
		return htmlComments.some((comment) =>
			htmlDocumented(anchor, comment, sourceCode),
		);
	}
	return sourceCode.getCommentsBefore(anchor).some((comment) => {
		if (!hasDescription(comment)) {
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

/** テンプレートの宣言には、他の要素を挟まない直前の HTML コメントだけを認める。 */
function htmlDocumented(anchor, comment, sourceCode) {
	if (!hasDescription(comment) || comment.range[1] > anchor.range[0]) {
		return false;
	}
	if (anchor.loc.start.line - comment.loc.end.line > 1) {
		return false;
	}
	return !sourceCode.text.slice(comment.range[1], anchor.range[0]).trim();
}

/** 別名や後置の export も、宣言と同じ束縛を公開する操作として記録する。 */
function exportedBindings(program, sourceCode, htmlComments) {
	const bindings = new Set();
	walk(program, sourceCode.visitorKeys, (node) => {
		if (node.type === "SvelteHTMLComment") {
			htmlComments.push(node);
		}
		let names = [];
		if (node.type === "ExportNamedDeclaration" && !node.source) {
			names = node.specifiers.map((specifier) => specifier.local.name);
		} else if (
			node.type === "ExportDefaultDeclaration" &&
			node.declaration.type === "Identifier"
		) {
			names = [node.declaration.name];
		}
		if (names.length === 0) {
			return;
		}
		const scope = sourceCode.getScope(node);
		for (const name of names) {
			const binding = scope.set.get(name);
			if (binding) {
				bindings.add(binding);
			}
		}
	});
	return bindings;
}

/** 外側の公開関数にある内部宣言は、直接 export されない限り非公開とする。 */
function isPublic(node, sourceCode, bindings) {
	const declaration = node.type === "VariableDeclarator" ? node.parent : node;
	if (
		["ExportNamedDeclaration", "ExportDefaultDeclaration"].includes(
			declaration.parent?.type,
		)
	) {
		return true;
	}
	return sourceCode
		.getDeclaredVariables(node)
		.some((binding) => bindings.has(binding));
}

/** 型注釈で包んだ関数やクラスも、名前付きの変数として検査する。 */
function variableDeclaration(node) {
	let value = node.init;
	while (value && isWrapper(value)) {
		value = value.expression;
	}
	if (node.id.type !== "Identifier" || !value) {
		return null;
	}
	if (
		["ArrowFunctionExpression", "FunctionExpression"].includes(value.type)
	) {
		return "関数";
	}
	return value.type === "ClassExpression" ? "クラス" : null;
}

/** 連続したオーバーロードと実装には、先頭の宣言で一度だけ説明を要求する。 */
function followsOverload(node) {
	const anchor =
		node.parent.type === "ExportNamedDeclaration" ? node.parent : node;
	const siblings = anchor.parent?.body;
	if (!Array.isArray(siblings)) {
		return false;
	}
	const before = siblings[siblings.indexOf(anchor) - 1];
	const previous =
		before?.type === "ExportNamedDeclaration" ? before.declaration : before;
	return (
		previous?.type === "TSDeclareFunction" &&
		previous.id?.name === node.id?.name
	);
}

module.exports = {
	meta: {
		type: "suggestion",
		schema: [],
		messages: {
			internal:
				"非公開の{{kind}} {{name}} の宣言直前に、役割や制約を説明するコメントを追加してください。",
			public: "公開する{{kind}} {{name}} の宣言直前に、利用側が守る前提や注意点を説明するコメントを追加してください。",
		},
	},
	create(context) {
		const sourceCode = context.sourceCode;
		const htmlComments = [];
		let bindings = new Set();
		/** 説明は実装から判断して書く必要があるため、自動修正で雛形を挿入しない。 */
		function check(node, kind) {
			if (!kind || documented(node, sourceCode, htmlComments)) {
				return;
			}
			const id = node.id;
			context.report({
				node: id ?? node,
				messageId: isPublic(node, sourceCode, bindings)
					? "public"
					: "internal",
				data: { kind, name: id?.name ?? "(無名)" },
			});
		}
		/** オーバーロードの実装を二重に報告せず、通常の関数はそれぞれ検査する。 */
		function checkFunction(node) {
			if (!followsOverload(node)) {
				check(node, "関数");
			}
		}
		return {
			Program(node) {
				bindings = exportedBindings(node, sourceCode, htmlComments);
			},
			FunctionDeclaration: checkFunction,
			TSDeclareFunction: checkFunction,
			ClassDeclaration(node) {
				check(node, "クラス");
			},
			TSTypeAliasDeclaration(node) {
				check(node, "型");
			},
			TSInterfaceDeclaration(node) {
				check(node, "型");
			},
			VariableDeclarator(node) {
				check(node, variableDeclaration(node));
			},
		};
	},
};

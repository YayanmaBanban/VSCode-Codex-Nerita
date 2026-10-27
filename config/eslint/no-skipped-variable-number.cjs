// 関数内のローカル変数に付いた末尾番号の孤立・欠番を検出する。

// 同じ関数内で見える変数・引数だけを番号の系列として扱う。
function localNames(scope) {
	const names = new Set();
	const owner = scope.variableScope;
	for (let current = scope; current; current = current.upper) {
		for (const variable of current.variables) {
			const local = variable.defs.some((definition) =>
				["Variable", "Parameter"].includes(definition.type),
			);
			if (local) {
				names.add(variable.name);
			}
		}
		if (current === owner) {
			break;
		}
	}
	return names;
}

module.exports = {
	meta: {
		type: "suggestion",
		schema: [],
		messages: {
			missingPrevious:
				"ローカル変数 '{{name}}' の番号が連番になっていません。同じ関数内に '{{previous}}'{{alternative}} が必要です。不要な番号は取り除いてください。",
		},
	},
	create(context) {
		return {
			VariableDeclarator(node) {
				const scope = context.sourceCode.getScope(node);
				if (scope.variableScope.type !== "function") {
					return;
				}
				const names = localNames(scope);
				// 分割代入も、プロパティ名ではなく実際に宣言する変数名を検査する。
				for (const variable of context.sourceCode.getDeclaredVariables(
					node,
				)) {
					const match = /^(.*\D)(\d+)$/u.exec(variable.name);
					if (!match || BigInt(match[2]) <= 1n) {
						continue;
					}
					const base = match[1];
					const number = BigInt(match[2]);
					const previous = `${base}${number - 1n}`;
					const startsWithBase = number === 2n && names.has(base);
					if (names.has(previous) || startsWithBase) {
						continue;
					}
					context.report({
						node: variable.identifiers[0],
						messageId: "missingPrevious",
						data: {
							name: variable.name,
							previous,
							alternative:
								number === 2n ? ` または '${base}'` : "",
						},
					});
				}
			},
		};
	},
};

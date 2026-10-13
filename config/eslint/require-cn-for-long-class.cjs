// Svelte の長い class 直接指定を検出し、cn の引数への分割を促す。

/** 動的な値は評価せず、属性に直接書かれた文字列部分だけを取り出す。 */
function staticClassText(value) {
	if (value.type === "SvelteLiteral") {
		return value.value;
	}
	const expression = value.expression;
	if (expression.type === "Literal" && typeof expression.value === "string") {
		return expression.value;
	}
	if (expression.type === "TemplateLiteral") {
		return expression.quasis
			.map((part) => part.value.cooked ?? part.value.raw)
			.join(" ");
	}
	return "";
}

module.exports = {
	meta: {
		type: "suggestion",
		docs: {
			description: "長い class の直接指定を cn() の複数引数に分割する",
		},
		schema: [
			{
				type: "object",
				properties: { maxLength: { type: "integer", minimum: 1 } },
				additionalProperties: false,
			},
		],
		messages: {
			useCn: "class の直接指定が {{length}} 文字あり、上限の {{maxLength}} 文字を超えています。cn() の複数引数に分割してください。",
		},
	},
	create(context) {
		const maxLength = context.options[0]?.maxLength ?? 120;
		return {
			SvelteAttribute(node) {
				if (node.key.name !== "class" || node.boolean) {
					return;
				}
				// 改行・インデントを長さに含めず、改行するだけの回避も認めない。
				const text = node.value
					.map(staticClassText)
					.join(" ")
					.trim()
					.replace(/\s+/gu, " ");
				if (text.length > maxLength) {
					// 引数の意味ごとの分割と import の選択は利用側に委ねる。
					context.report({
						node,
						messageId: "useCn",
						data: { length: text.length, maxLength },
					});
				}
			},
		};
	},
};

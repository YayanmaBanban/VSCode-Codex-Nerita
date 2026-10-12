// 利用者の方針に従い、if の条件を先に評価してヘッダーを1行に保つ。
module.exports = {
	meta: {
		type: "layout",
		schema: [],
		messages: {
			singleLine:
				"if の条件式を1行に収めてください。条件の評価を変数や名前付きの処理へ分離し、短絡評価と評価順序を維持してください。",
		},
	},
	create(context) {
		return {
			IfStatement(node) {
				// 式本体だけでなく、if・外側の括弧を別行に置く書き方も検出する。
				// 本体や、本体の前にあるコメントの改行は条件の改行に含めない。
				const closing = context.sourceCode.getTokenBefore(
					node.consequent,
				);
				if (node.loc.start.line !== closing.loc.end.line) {
					context.report({
						node: node.test,
						messageId: "singleLine",
					});
				}
			},
		};
	},
};

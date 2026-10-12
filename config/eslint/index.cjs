// npm 公開を必要としない、Nerita 専用の可読性 ESLint プラグイン。
module.exports = {
	meta: {
		name: "eslint-plugin-nerita",
		namespace: "nerita",
		version: "0.0.1",
	},
	rules: {
		"no-complex-boolean-expression": require("./no-complex-boolean-expression.cjs"),
		"no-nested-ternary-expression": require("./no-nested-ternary-expression.cjs"),
		"no-complex-inline-callback": require("./no-complex-inline-callback.cjs"),
		"no-await-in-condition": require("./no-await-in-condition.cjs"),
		"no-multiline-if-condition": require("./no-multiline-if-condition.cjs"),
		"require-member-function-comment": require("./require-member-function-comment.cjs"),
	},
};

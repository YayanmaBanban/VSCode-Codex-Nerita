// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import typescriptEslint from "typescript-eslint";

export default defineConfig([
	globalIgnores([".vscode-test/**", "coverage/**", "dist/**", "out/**"]),
	js.configs.recommended,
	{
		files: ["**/*.{js,mjs,cjs,ts,tsx}"],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		linterOptions: {
			reportUnusedDisableDirectives: "error",
		},
		rules: {
			curly: ["error", "all"],
			eqeqeq: ["error", "always"],
			"no-duplicate-imports": "error",
			"object-shorthand": ["error", "always"],
			"prefer-template": "error",
		},
	},
	{
		files: ["tests/**/*.ts"],
		languageOptions: {
			globals: {
				...globals.mocha,
			},
		},
	},
	{
		files: ["**/*.{ts,tsx}"],
		extends: [typescriptEslint.configs.recommendedTypeChecked],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/consistent-type-assertions": [
				"error",
				{
					assertionStyle: "as",
					arrayLiteralTypeAssertions: "never",
					objectLiteralTypeAssertions: "never",
				},
			],
			"@typescript-eslint/consistent-type-definitions": ["error", "type"],
			"@typescript-eslint/consistent-type-exports": [
				"error",
				{
					fixMixedExportsWithInlineTypeSpecifier: true,
				},
			],
			"@typescript-eslint/consistent-type-imports": [
				"error",
				{
					prefer: "type-imports",
					fixStyle: "inline-type-imports",
				},
			],
			"@typescript-eslint/naming-convention": [
				"error",
				{
					selector: "variable",
					format: ["camelCase", "PascalCase", "UPPER_CASE"],
					leadingUnderscore: "allow",
				},
				{
					selector: "function",
					format: ["camelCase", "PascalCase"],
				},
				{
					selector: "parameter",
					format: ["camelCase"],
					leadingUnderscore: "allow",
				},
				{
					selector: "typeLike",
					format: ["PascalCase"],
				},
				{
					selector: "property",
					format: null,
				},
				{
					selector: "import",
					format: null,
				},
			],
			"@typescript-eslint/no-unnecessary-type-assertion": "error",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
				},
			],
			"no-restricted-syntax": [
				"error",
				{
					selector: "TSEnumDeclaration",
					message:
						"Use union types or const objects instead of enum.",
				},
				{
					selector: "ExportDefaultDeclaration",
					message: "Use named exports instead of default exports.",
				},
				{
					selector:
						'CallExpression[callee.property.name="forEach"] > ArrowFunctionExpression[async=true]',
					message:
						"Use for...of or Promise.all instead of async forEach callbacks.",
				},
			],
		},
	},
	{
		// ツールが要求する default export を設定ファイルで許可する。
		files: [
			"config/**/*.{ts,tsx}",
			"tests/e2e/config/*.ts",
			"**/*.stories.tsx",
		],
		rules: { "no-restricted-syntax": "off" },
	},
	{
		files: ["src/webview/**/*.{ts,tsx}"],
		languageOptions: { globals: globals.browser },
	},
	prettier,
	...storybook.configs["flat/recommended"],
]);

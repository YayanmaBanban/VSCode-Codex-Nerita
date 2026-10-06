import sonarjs from "eslint-plugin-sonarjs";
import reactHooks from "eslint-plugin-react-hooks";
import regexp from "eslint-plugin-regexp";
import jsxA11yX from "eslint-plugin-jsx-a11y-x";
// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";
import vitest from "@vitest/eslint-plugin";
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import typescriptEslint from "typescript-eslint";
import { builtinModules } from "node:module";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";

const platformImports = [
	"vscode",
	...builtinModules,
	...builtinModules.map((name) => `node:${name}`),
];

export default defineConfig([
	globalIgnores([
		".gitnexus/**",
		".vscode-test/**",
		"coverage/**",
		"**/dist/**",
		"out/**",
		"apps/vscode-nerita/src/extension/backends/codex/codex-app-server/**",
	]),
	regexp.configs.recommended,
	js.configs.recommended,
	prettier,
	...storybook.configs["flat/recommended"],
	{
		files: ["**/*.{js,mjs,cjs,ts,tsx}"],
		plugins: {
			sonarjs,
		},
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		linterOptions: {
			reportUnusedDisableDirectives: "error",
		},
		rules: {
			// ifに中括弧がない
			curly: ["error", "all"],
			// ===を強制
			eqeqeq: ["error", "always"],
			// 重複した同じインポート
			"no-duplicate-imports": "error",
			// ネストになった三項演算子
			"no-nested-ternary": "error",
			// プロパティ名が同じなら省略する
			"object-shorthand": ["error", "always"],
			// 文字列の結合にはテンプレートリテラルを使う
			"prefer-template": "error",
			// 関数内の分岐の数
			complexity: ["error", 10],
			// ネストの深さ
			"max-depth": ["error", 3],
			// コールバックの入れ子を2段までに制限する。
			"max-nested-callbacks": [
				"error",
				{
					max: 2,
					checkConstructorCallCallbacks: true,
				},
			],
			// 空行とコメントを除き、関数あたりの行数を80行までに制限する。
			"max-lines-per-function": [
				"error",
				{
					max: 80,
					skipBlankLines: true,
					skipComments: true,
				},
			],
			// 人間にとって理解しにくい関数
			"sonarjs/cognitive-complexity": ["error", 15],
			// DRY・AIによる重複実装
			"sonarjs/no-identical-functions": ["error", 5],
			// 同じif/switchの分岐
			"sonarjs/no-duplicated-branches": "error",
			// 全ての分岐が同一という明確な異常
			"sonarjs/no-all-duplicated-branches": "error",
			// 同じ条件をelse-if等で再利用
			"sonarjs/no-identical-conditions": "error",
			// foo === foo 等のロジック異常
			"sonarjs/no-identical-expressions": "error",
			// 不要に複雑な条件構造
			"sonarjs/no-collapsible-if": "error",
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
			"@typescript-eslint/switch-exhaustiveness-check": [
				"error",
				{
					allowDefaultCaseForExhaustiveSwitch: false,
					considerDefaultExhaustiveForUnions: false,
				},
			],
			"@typescript-eslint/no-deprecated": "error",
			// 常にtrue/falseになる条件
			"@typescript-eslint/no-unnecessary-condition": [
				"error",
				{
					allowConstantLoopConditions: "only-allowed-literals",
				},
			],
			// void戻り値の誤用
			"@typescript-eslint/no-confusing-void-expression": [
				"error",
				{
					ignoreArrowShorthand: true,
					ignoreVoidOperator: true,
				},
			],
			// Boolean判定の対象を明示化する
			"@typescript-eslint/strict-boolean-expressions": [
				"error",
				{
					allowString: false,
					allowNumber: false,
					allowNullableObject: true,
				},
			],
			// null合体演算子を強制
			"@typescript-eslint/prefer-nullish-coalescing": "error",
		},
	},
	{
		// ツールが要求する default export を設定ファイルで許可する。
		files: [
			"apps/nerita-ui/.storybook/**/*.{ts,tsx}",
			"apps/nerita-ui/vitest.config.ts",
			"**/*.stories.tsx",
		],
		rules: { "no-restricted-syntax": "off" },
	},
	{
		files: [
			"apps/nerita-ui/src/**/*.{ts,tsx}",
			"apps/nerita-ui/stories/**/*.{ts,tsx}",
		],
		...jsxA11yX.configs.recommended,
		languageOptions: {
			...jsxA11yX.configs.recommended.languageOptions,
			globals: {
				...globals.browser,
			},
		},
	},
	{
		files: ["apps/nerita-ui/vitest.config.ts"],
		languageOptions: {
			parserOptions: {
				projectService: false,
				project: "apps/nerita-ui/tsconfig.tools.json",
			},
		},
	},
	{
		files: [
			"apps/nerita-ui/src/**/*.{ts,tsx}",
			"packages/shared/src/**/*.ts",
		],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: platformImports,
					patterns: [
						"**/extension/**",
						"@/extension/**",
						"**/stories/**",
						"**/tests/**",
					],
				},
			],
		},
	},
	{
		files: ["packages/shared/src/**/*.ts"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: [...platformImports, "react", "react-dom"],
					patterns: [
						"react/*",
						"react-dom/*",
						"**/extension/**",
						"**/nerita-ui/**",
						"@nerita/ui",
						"@nerita/ui/*",
						"**/tests/**",
					],
				},
			],
		},
	},
	{
		files: ["apps/vscode-nerita/src/extension/**/*.ts"],
		rules: {
			"no-restricted-imports": [
				"error",
				{ patterns: ["**/nerita-ui/**", "@nerita/ui", "@nerita/ui/*"] },
			],
		},
	},
	{
		files: ["apps/nerita-ui/src/**/*.{ts,tsx}"],
		ignores: ["apps/nerita-ui/src/bridge/vscodeBridge.ts"],
		rules: { "no-restricted-globals": ["error", "acquireVsCodeApi"] },
	},
	{
		files: ["apps/nerita-ui/src/**/*.{ts,tsx}"],
		plugins: {
			"react-hooks": reactHooks,
		},
		rules: {
			"react-hooks/rules-of-hooks": "error",
			"react-hooks/exhaustive-deps": "error",
			"react-hooks/immutability": "error",
			"react-hooks/purity": "error",
			"react-hooks/refs": "error",
			"react-hooks/set-state-in-render": "error",
		},
	},
	{
		files: ["apps/nerita-ui/src/**/*.{ts,tsx}"],
		plugins: {
			"better-tailwindcss": betterTailwindcss,
		},
		settings: {
			"better-tailwindcss": {
				cwd: "./apps/nerita-ui",
				entryPoint: "src/chat/tailwind.css",
			},
		},
		rules: {
			// cn() の各引数は1行で記述し、呼び出し全体の改行は Prettier に任せる。
			"better-tailwindcss/enforce-consistent-line-wrapping": [
				"warn",
				{ preferSingleLine: true, printWidth: 0 },
			],
			"better-tailwindcss/enforce-consistent-class-order": "warn",
		},
	},
	{
		files: ["apps/nerita-ui/stories/**/*.{ts,tsx}"],
		plugins: {
			"better-tailwindcss": betterTailwindcss,
		},
		settings: {
			"better-tailwindcss": {
				cwd: "./apps/nerita-ui",
				entryPoint: ".storybook/tailwind.css",
			},
		},
		rules: {
			"better-tailwindcss/enforce-consistent-line-wrapping": [
				"warn",
				{ preferSingleLine: true, printWidth: 0 },
			],
			"better-tailwindcss/enforce-consistent-class-order": "warn",
		},
	},
	{
		files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
		plugins: {
			vitest,
		},
		rules: {
			"vitest/no-focused-tests": "error",
			"vitest/no-standalone-expect": "error",
			"vitest/no-conditional-expect": "error",
		},
	},
]);

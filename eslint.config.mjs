import svelte from "eslint-plugin-svelte";
import * as extraFileParser from "typescript-eslint-parser-for-extra-files";
import nerita from "./config/eslint/index.cjs";
import sonarjs from "eslint-plugin-sonarjs";
import regexp from "eslint-plugin-regexp";
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
import importPlugin from "eslint-plugin-import";

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
		files: ["**/*.{js,mjs,cjs,ts,tsx,mts,svelte}"],
		plugins: {
			nerita,
			sonarjs,
			import: importPlugin,
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
			// 条件分岐やループの本体を中括弧で囲む。
			curly: ["error", "all"],
			// 等価比較には型変換のない厳密比較を使う。
			eqeqeq: ["error", "always"],
			// 同じモジュールからの重複したインポートを禁止する。
			"no-duplicate-imports": "error",
			// import・require のまとまりと後続の処理の間に空行を入れる。
			"import/newline-after-import": ["error", { count: 1 }],
			// 三項演算子の入れ子を禁止する。
			"no-nested-ternary": "error",
			// オブジェクトで使える短縮記法を必須にする。
			"object-shorthand": ["error", "always"],
			// 文字列の結合にはテンプレートリテラルを使う。
			"prefer-template": "error",
			// 関数の循環的複雑度を10以下に制限する。
			complexity: ["error", 10],
			// 制御構文の入れ子を3段までに制限する。
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
			// 関数の認知的複雑度を15以下に制限する。
			"sonarjs/cognitive-complexity": ["error", 15],
			// 同じ実装を持つ関数の重複を検出する。
			"sonarjs/no-identical-functions": ["error", 5],
			// 同じ実装を持つ分岐の重複を禁止する。
			"sonarjs/no-duplicated-branches": "error",
			// 全ての分岐が同じ実装になる条件分岐を禁止する。
			"sonarjs/no-all-duplicated-branches": "error",
			// 一連の条件分岐で同じ条件を繰り返さない。
			"sonarjs/no-identical-conditions": "error",
			// 両辺が同じ式になる不要な比較・演算を検出する。
			"sonarjs/no-identical-expressions": "error",
			// 統合できる入れ子の `if` を検出する。
			"sonarjs/no-collapsible-if": "error",
			// 1つの式に含まれる条件演算子の数を2個までに制限する。
			"sonarjs/expression-complexity": ["error", { max: 2 }],
		},
	},
	{
		// Webview・Extension Host・DLC・共有契約の製品ソースへ適用する。
		files: [
			"apps/**/src/**/*.{ts,tsx,svelte}",
			"packages/shared/src/**/*.ts",
		],
		rules: {
			"nerita/no-complex-boolean-expression": "error",
			"nerita/no-nested-ternary-expression": "error",
			"nerita/no-complex-inline-callback": "error",
			"nerita/no-await-in-condition": "error",
			"nerita/no-multiline-if-condition": "error",
			"nerita/no-skipped-variable-number": "error",
			"nerita/require-member-function-comment": "error",
			// 各ファイルの役割を、コードや要素より前のコメントで説明する。
			"nerita/require-file-comment": "error",
			"nerita/require-declaration-comment": "error",
			// 独自ルールが標準ルールの対象も検査するため、同じ式を二重報告しない。
			"no-nested-ternary": "off",
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
		files: ["**/*.{ts,tsx,mts,svelte}"],
		extends: [typescriptEslint.configs.recommendedTypeChecked],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: [".svelte"],
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
			// 型から結果が決まる不要な条件を検出する。
			"@typescript-eslint/no-unnecessary-condition": [
				"error",
				{
					allowConstantLoopConditions: "only-allowed-literals",
				},
			],
			// `void` を返す式の紛らわしい利用を検出する。
			"@typescript-eslint/no-confusing-void-expression": [
				"error",
				{
					ignoreArrowShorthand: true,
					ignoreVoidOperator: true,
				},
			],
			// 条件式で使う値は型に応じて明示的に判定する。
			// `strict-boolean-expressions` が求める `unknown` の `Boolean()` 変換を自動削除しない。
			"no-extra-boolean-cast": "off",
			"@typescript-eslint/strict-boolean-expressions": [
				"error",
				{
					allowString: false,
					allowNumber: false,
					allowNullableObject: true,
				},
			],
			// 真偽値と `true` / `false` の不要な比較を禁止する。
			"@typescript-eslint/no-unnecessary-boolean-literal-compare":
				"error",
			// 結果の型が変わらない不要な型変換を検出する。
			"@typescript-eslint/no-unnecessary-type-conversion": "error",
			// 未指定の値を補う処理で使える場合は、null 合体演算子を優先する。
			"@typescript-eslint/prefer-nullish-coalescing": "error",
			// 型を狭める型アサーションを禁止する。
			"@typescript-eslint/no-unsafe-type-assertion": "error",
			// Promise の拒否理由を受け取るコールバックでは、引数を `unknown` として扱う。
			"@typescript-eslint/use-unknown-in-catch-callback-variable":
				"error",
			// 未知の型や既定のオブジェクト表現しか持たない値を文字列へ変換しない。
			"@typescript-eslint/no-base-to-string": [
				"error",
				{
					checkUnknown: true,
				},
			],
		},
	},
	{
		// ツールが要求する default export を設定ファイルで許可する。
		files: [
			"apps/nerita-ui/.storybook/**/*.{ts,tsx}",
			"apps/nerita-ui/vitest.config.mts",
			"**/*.stories.tsx",
		],
		rules: { "no-restricted-syntax": "off" },
	},
	{
		files: [
			"apps/nerita-ui/vitest.config.mts",
			"apps/nerita-ui/storybookDependencies.mts",
		],
		languageOptions: {
			parserOptions: {
				projectService: false,
				project: "apps/nerita-ui/tsconfig.tools.json",
			},
		},
	},
	{
		files: [
			"apps/nerita-ui/src/**/*.{ts,tsx,svelte}",
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
		files: ["packages/shared/src/**/*.ts", "apps/nerita-dlc/src/**/*.ts"],
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
		files: ["apps/nerita-ui/src/**/*.{ts,tsx,svelte}"],
		ignores: ["apps/nerita-ui/src/bridge/vscodeBridge.ts"],
		rules: { "no-restricted-globals": ["error", "acquireVsCodeApi"] },
	},
	{
		files: ["apps/nerita-ui/src/**/*.{ts,tsx,svelte}"],
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
	...svelte.configs.recommended,
	{
		// 製品 UI の長い class は cn() の複数引数へ分割する。
		files: ["apps/nerita-ui/src/**/*.svelte"],
		rules: { "nerita/require-cn-for-long-class": "error" },
	},
	{
		// 製品とストーリーの Svelte では、副作用を登録する理由を明示する。
		files: [
			"apps/nerita-ui/{src,stories}/**/*.{svelte,svelte.ts,svelte.js}",
		],
		rules: { "nerita/require-effect-reason": "error" },
	},
	{
		files: ["**/*.svelte", "**/*.svelte.ts"],
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				parser: extraFileParser,
				projectService: true,
				extraFileExtensions: [".svelte"],
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		// Svelte CSF が要求するメタ情報の default export だけを許可する。
		files: ["**/*.stories.ts"],
		rules: {
			"no-restricted-syntax": [
				"error",
				{
					selector: "TSEnumDeclaration",
					message:
						"Use union types or const objects instead of enum.",
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
]);

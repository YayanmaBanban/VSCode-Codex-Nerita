// 設定ファイルとエディターが共有する形式。JSON Schema はこの定義から生成する。
import { z } from "zod";
import { builtinRulesSchema, defaultBuiltinRules } from "./builtins";

export const guardActionSchema = z.enum(["allow", "ask", "deny"]);
export const operationSchema = z.enum(["read", "write"]);
const relativePattern = z
	.string()
	.min(1)
	.max(256)
	.regex(
		/^(?![\\/])(?!.*:)(?!.+\\)(?!.*(?:^|\/)\.\.(?:\/|$))[\u0020-\uffff]+$/,
		"基準からの相対パスを / 区切りで指定してください。.. は使用できません。",
	);
const ruleFields = {
	id: z
		.string()
		.min(1)
		.max(80)
		.regex(/^[\w-]+$/),
	reason: z.string().min(1).max(500),
	action: guardActionSchema,
};
export const pathRuleSchema = z.strictObject({
	...ruleFields,
	match: z.enum(["glob", "directory"]),
	pattern: relativePattern,
	exceptions: z.array(relativePattern).max(30),
	operations: z.array(operationSchema).min(1).max(2),
});
export const commandRuleSchema = z.strictObject({
	...ruleFields,
	shell: z.enum(["any", "powershell", "pwsh", "bash"]),
	match: z.literal("contains"),
	pattern: z.string().trim().min(1).max(256),
});
export const guardrailsConfigSchema = z.strictObject({
	version: z.literal(1),
	builtins: builtinRulesSchema,
	pathAccess: z.strictObject({
		outsideRead: guardActionSchema,
		outsideWrite: z.literal("deny"),
	}),
	pathRules: z.array(pathRuleSchema).max(100),
	commandRules: z.array(commandRuleSchema).max(100),
});
/** パス・コマンドのアクセス判定設定。外部入力は `guardrailsConfigSchema` で検証してから扱う。 */
export type GuardrailsConfig = z.infer<typeof guardrailsConfigSchema>;
/** パス条件と操作別の判定を指定するルール。外部入力は `pathRuleSchema` で検証してから扱う。 */
export type PathRule = z.infer<typeof pathRuleSchema>;
/** 許可・承認・拒否の判定値。外部入力は `guardActionSchema` で検証してから扱う。 */
export type GuardAction = z.infer<typeof guardActionSchema>;

/** 初回も外部読取りを拒否し、書込みとシェルの承認は既存経路で維持する。 */
export function defaultGuardrails(): GuardrailsConfig {
	return {
		version: 1,
		builtins: defaultBuiltinRules(),
		pathAccess: { outsideRead: "deny", outsideWrite: "deny" },
		pathRules: [],
		commandRules: [],
	};
}

/** 未知の項目や重複したルール ID を検出し、呼び出し側へ検証エラーを返す。 */
export function parseGuardrails(text: string): GuardrailsConfig {
	if (text.length > 131072) {
		throw new Error("ガードレール設定は131072文字以内にしてください。");
	}
	const config = guardrailsConfigSchema.parse(JSON.parse(text));
	const ids = [...config.pathRules, ...config.commandRules].map(
		(rule) => rule.id,
	);
	if (new Set(ids).size !== ids.length) {
		throw new Error("ルールIDが重複しています。");
	}
	for (const rule of config.pathRules) {
		if (rule.match !== "glob" && /[*?]/.test(rule.pattern)) {
			throw new Error(
				`${rule.id}: ディレクトリ配下の指定にはワイルドカードを使用できません。`,
			);
		}
	}
	return config;
}

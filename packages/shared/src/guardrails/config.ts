// 設定ファイルとエディターが共有する形式。JSON Schema はこの定義から生成する。
import { z } from "zod";

export const guardActionSchema = z.enum(["allow", "ask", "deny"]);
export const operationSchema = z.enum(["read", "write"]);
const relativePattern = z
	.string()
	.min(1)
	.max(256)
	.regex(
		/^(?![\\/])(?!.*:)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[\u0020-\uffff]+$/,
		"基準からの相対パスを / 区切りで指定してください。.. は使用できません。",
	);
const ruleFields = {
	id: z
		.string()
		.min(1)
		.max(80)
		.regex(/^[a-zA-Z0-9_-]+$/),
	reason: z.string().min(1).max(500),
	action: guardActionSchema,
};
export const pathRuleSchema = z.strictObject({
	...ruleFields,
	base: z.enum(["workspace", "home"]),
	match: z.enum(["glob", "file", "directory"]),
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
	pathAccess: z.strictObject({
		outsideRead: guardActionSchema,
		outsideWrite: z.literal("deny"),
	}),
	pathRules: z.array(pathRuleSchema).max(100),
	commandRules: z.array(commandRuleSchema).max(100),
});
export type GuardrailsConfig = z.infer<typeof guardrailsConfigSchema>;
export type PathRule = z.infer<typeof pathRuleSchema>;
export type GuardAction = z.infer<typeof guardActionSchema>;

/** 初回も外部読取りを拒否し、書込みとシェルの承認は既存経路で維持する。 */
export function defaultGuardrails(): GuardrailsConfig {
	return {
		version: 1,
		pathAccess: { outsideRead: "deny", outsideWrite: "deny" },
		pathRules: [
			{
				id: "env-files",
				reason: "秘密値を含む可能性があるファイルです。",
				action: "deny",
				base: "workspace",
				match: "glob",
				pattern: ".env*",
				exceptions: [".env.example", ".env.sample"],
				operations: ["read", "write"],
			},
		],
		commandRules: [],
	};
}

/** 未知の項目・重複 ID を黙って無視せず、保存前に利用者へ返す。 */
export function parseGuardrails(text: string): GuardrailsConfig {
	if (text.length > 131072) {
		throw new Error("設定は128 Ki文字以内にしてください。");
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
				`${rule.id}: file / directory ではワイルドカードを使用できません。`,
			);
		}
	}
	return config;
}

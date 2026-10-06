// Binding は参照と秘密値を含まないメタデータだけを扱う。秘密値の入力はこの通信契約に含めない。
import { z } from "zod";

export const credentialStorageModeSchema = z.enum([
	"session",
	"secret-storage",
]);
export type CredentialStorageMode = z.infer<typeof credentialStorageModeSchema>;
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
const target = z
	.string()
	.max(512)
	.regex(/^[a-zA-Z0-9.-]+(?::[0-9]+)?(?:\/[-a-zA-Z0-9._~%/]*)?$/);
export const credentialKindSchema = z.enum([
	"git-https",
	"npm-registry",
	"api-token",
	"username-password",
]);
export type CredentialKind = z.infer<typeof credentialKindSchema>;
/** 未知の項目を捨てて保存せず、秘密値を含む可能性がある入力全体を拒否する。 */
export const credentialBindingSchema = z
	.object({
		id,
		match: z.object({ kind: credentialKindSchema, target }).strict(),
		provider: z.discriminatedUnion("type", [
			z.object({ type: z.literal("git") }).strict(),
			z.object({ type: z.literal("npmrc") }).strict(),
			z
				.object({
					type: z.literal("bitwarden-secrets-manager"),
					secretId: z.uuid(),
					projectId: z.uuid().optional(),
					accountId: id.default("default"),
				})
				.strict(),
		]),
		injection: z.discriminatedUnion("type", [
			z.object({ type: z.literal("git-https") }).strict(),
			z.object({ type: z.literal("npm-auth-token") }).strict(),
			z
				.object({
					type: z.literal("env"),
					name: z
						.string()
						.regex(/^[A-Z][A-Z0-9_]{0,63}$/)
						.refine(
							(value) =>
								!/^(?:PATH|PATHEXT|COMSPEC|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|NODE_OPTIONS|NODE_PATH|BWS_ACCESS_TOKEN|NPM_CONFIG_|GIT_|LD_|DYLD_|PSMODULEPATH)/.test(
									value,
								),
						),
				})
				.strict(),
		]),
	})
	.strict()
	.superRefine((value, ctx) => {
		const expected = {
			"git-https": "git-https",
			"npm-registry": "npm-auth-token",
			"api-token": "env",
			"username-password": "env",
		}[value.match.kind];
		if (
			value.injection.type !== expected ||
			(value.provider.type === "git" &&
				value.match.kind !== "git-https") ||
			(value.provider.type === "npmrc" &&
				value.match.kind !== "npm-registry")
		) {
			ctx.addIssue({
				code: "custom",
				message: "対象と Provider・注入方式が一致しません。",
			});
		}
	});
export type CredentialBinding = z.infer<typeof credentialBindingSchema>;
export const credentialBindingsSchema = z
	.object({
		version: z.literal(1),
		bindings: z.array(credentialBindingSchema).max(256),
	})
	.strict()
	.refine(
		(value) =>
			new Set(value.bindings.map((binding) => binding.id)).size ===
			value.bindings.length,
		"Binding ID が重複しています。",
	)
	.refine(
		(value) =>
			new Set(
				value.bindings.map((binding) => JSON.stringify(binding.match)),
			).size === value.bindings.length,
		"同じ対象への Binding が重複しています。",
	);
export const credentialRequestSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("ready") }).strict(),
	z
		.object({
			type: z.literal("save-binding"),
			binding: credentialBindingSchema,
		})
		.strict(),
	z.object({ type: z.literal("delete-binding"), id }).strict(),
	z
		.object({
			type: z.literal("bws-login"),
			mode: credentialStorageModeSchema,
			accountId: id,
		})
		.strict(),
	z.object({ type: z.literal("bws-logout"), accountId: id }).strict(),
	z.object({ type: z.literal("migrate-pi") }).strict(),
	z.object({ type: z.literal("migrate-mcp") }).strict(),
]);
export type CredentialRequest = z.infer<typeof credentialRequestSchema>;
export const credentialReplySchema = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("state"),
			bindings: z.array(credentialBindingSchema),
			providers: z.array(
				z
					.object({
						id: z.string(),
						accountId: id.optional(),
						available: z.boolean(),
						authenticated: z.boolean(),
						mode: credentialStorageModeSchema.nullable(),
					})
					.strict(),
			),
			busy: z.boolean(),
		})
		.strict(),
	z.object({ type: z.literal("error"), message: z.string() }).strict(),
	z.object({ type: z.literal("notice"), message: z.string() }).strict(),
]);
export type CredentialReply = z.infer<typeof credentialReplySchema>;
export type CredentialBridge = {
	postMessage: (request: CredentialRequest) => void;
	subscribe: (listener: (reply: CredentialReply) => void) => () => void;
};

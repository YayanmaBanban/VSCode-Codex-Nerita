// 論理ツールの承認契約。バイナリの形式と通常のアクセス拒否を権限キーへ混在させない。
import { z } from "zod";

export const commandClassSchema = z.enum([
	"read-only-ish",
	"execution",
	"installation-network",
]);
export type CommandClass = z.infer<typeof commandClassSchema>;
export const executionRouteSchema = z.enum(["mxc", "docker", "host"]);
export const commandPermissionKeySchema = z
	.object({
		tool: z.string().min(1),
		commandClass: commandClassSchema,
		workspace: z.string().min(1),
		route: executionRouteSchema,
	})
	.strict();
export type CommandPermissionKey = z.infer<typeof commandPermissionKeySchema>;

export const commandApprovalScopeSchema = z.enum([
	"once",
	"session",
	"workspace",
]);
export type CommandApprovalScope = z.infer<typeof commandApprovalScopeSchema>;

/** 互換性の診断はリソース許可の追加候補には変換しない。 */
export type SandboxCompatibilityEvent = {
	id: string;
	permission: CommandPermissionKey;
	backend: "mxc" | "docker";
	reason: string;
	code: "native-pnpm-dos-path";
};

export const commandGrantSchema = z
	.object({
		permission: commandPermissionKeySchema,
		scope: z.enum(["session", "workspace"]),
	})
	.strict();
export type CommandGrant = z.infer<typeof commandGrantSchema>;

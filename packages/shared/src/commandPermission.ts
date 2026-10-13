// 論理ツールの承認契約。バイナリの形式と通常のアクセス拒否を権限キーへ混在させない。
import { z } from "zod";

export const commandClassSchema = z.enum([
	"read-only-ish",
	"execution",
	"installation-network",
]);
/** 承認対象のコマンド分類。外部入力は `commandClassSchema` で検証してから扱う。 */
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
/** 承認対象のコマンド・作業場所・実行環境を識別するキー。外部入力は `commandPermissionKeySchema` で検証してから扱う。 */
export type CommandPermissionKey = z.infer<typeof commandPermissionKeySchema>;

export const commandApprovalScopeSchema = z.enum([
	"once",
	"session",
	"workspace",
]);
/** コマンド承認の有効範囲。外部入力は `commandApprovalScopeSchema` で検証してから扱う。 */
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
/** コマンドの承認内容と有効範囲。外部入力は `commandGrantSchema` で検証してから扱う。 */
export type CommandGrant = z.infer<typeof commandGrantSchema>;

/** 資格情報の保存キーを、その取得先が分かる名称で表示する。 */
export function commandPermissionLabel(
	permission: CommandPermissionKey,
): string {
	if (!permission.tool.startsWith("credential:")) {
		return permission.tool;
	}
	try {
		const tuple = z
			.tuple([z.string(), z.string(), z.string(), z.string(), z.string()])
			.safeParse(JSON.parse(permission.tool.slice("credential:".length)));
		return tuple.success
			? `資格情報 · ${tuple.data[3]} · ${tuple.data[0]}`
			: permission.tool;
	} catch {
		return permission.tool;
	}
}

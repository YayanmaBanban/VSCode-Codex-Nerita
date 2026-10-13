// Sandbox のリソース分類と管理画面の操作契約。秘密情報の値は通信しない。
import { z } from "zod";

export const resourceKindSchema = z.enum([
	"install",
	"config",
	"cache",
	"credential",
	"environment",
	"helper",
]);
/** 実行ツールが扱うリソースの種類。外部入力は `resourceKindSchema` で検証してから扱う。 */
export type ResourceKind = z.infer<typeof resourceKindSchema>;
export const resourceScopeSchema = z.enum(["process", "session", "workspace"]);
/** リソース権限の有効範囲。外部入力は `resourceScopeSchema` で検証してから扱う。 */
export type ResourceScope = z.infer<typeof resourceScopeSchema>;

/** 拒否イベントの明示操作で追加した権限。実行・保存先は Host が決める。 */
export const resourceGrantSchema = z.object({
	id: z.string().min(1),
	resource: z.object({
		kind: z.enum(["install", "helper", "config"]),
		target: z.string().min(1),
		tool: z.string().min(1),
		profileTarget: z.string().min(1),
	}),
	access: z.literal("read"),
	scope: resourceScopeSchema,
	source: z.literal("denial"),
	workspace: z.string().min(1),
	denialEventId: z.string().min(1),
	operationId: z.string().min(1),
});
/** 対象・アクセス種別・有効範囲を持つリソース権限。外部入力は `resourceGrantSchema` で検証してから扱う。 */
export type ResourceGrant = z.infer<typeof resourceGrantSchema>;

/** キャッシュ切替はファイル権限とは別のワークスペース設定として保存する。 */
export const sandboxCacheSchema = z.object({
	id: z.string().min(1),
	workspace: z.string().min(1),
	tool: z.string().min(1),
});
/** ツールとワークスペースに限定したキャッシュの切替。外部入力は `sandboxCacheSchema` で検証してから扱う。 */
export type SandboxCache = z.infer<typeof sandboxCacheSchema>;

/** 検出元は説明に使い、検出された事実だけで追加権限を承認しない。 */
export type ResourcePolicy = {
	id: string;
	kind: ResourceKind;
	target: string;
	access: "deny" | "read" | "readwrite";
	source: "generic" | "profile" | "denial";
	tool?: string;
	scope: ResourceScope;
};

/** UI に渡す値は識別情報のみ。環境変数や設定の中身を含めない。 */
export type DenialEvent = {
	id: string;
	target: string;
	resourceType: "file" | "ui" | "network" | "capability" | "other";
	resource?: ResourcePolicy;
	requestedAccess: string;
	estimatedTool?: string;
};

/** Host が持つイベント ID を選択する。Webview から任意のパスを許可させない。 */
export const resourceDecisionSchema = z.discriminatedUnion("action", [
	z
		.object({ denialEventId: z.string().min(1), action: z.literal("deny") })
		.strict(),
	z
		.object({
			denialEventId: z.string().min(1),
			action: z.literal("allow"),
			scope: resourceScopeSchema,
		})
		.strict(),
	z
		.object({
			denialEventId: z.string().min(1),
			action: z.literal("use-sandbox-cache"),
		})
		.strict(),
]);
/** 拒否されたリソースへの対応要求。外部入力は `resourceDecisionSchema` で検証してから扱う。 */
export type ResourceDecision = z.infer<typeof resourceDecisionSchema>;

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
export type ResourceKind = z.infer<typeof resourceKindSchema>;
export const resourceScopeSchema = z.enum(["process", "session", "workspace"]);
export type ResourceScope = z.infer<typeof resourceScopeSchema>;

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
		.object({ eventId: z.string().min(1), action: z.literal("deny") })
		.strict(),
	z
		.object({
			eventId: z.string().min(1),
			action: z.literal("allow"),
			scope: resourceScopeSchema,
		})
		.strict(),
	z
		.object({
			eventId: z.string().min(1),
			action: z.literal("use-sandbox-cache"),
		})
		.strict(),
]);
export type ResourceDecision = z.infer<typeof resourceDecisionSchema>;

// Sandbox 管理画面の専用通信。Webview は任意の実行ファイルや許可パスを指定しない。
import { z } from "zod";
import {
	commandGrantSchema,
	commandPermissionKeySchema,
} from "./commandPermission";
import {
	resourceKindSchema,
	resourceScopeSchema,
	resourceGrantSchema,
	sandboxCacheSchema,
	resourceDecisionSchema,
} from "./sandboxPolicy";

export const sandboxAvailabilitySchema = z.object({
	id: z.enum(["mxc", "docker"]),
	name: z.string(),
	available: z.boolean(),
	reason: z.string().optional(),
	isolationTier: z.string().optional(),
	availableMethods: z.array(z.string()),
	uiCapabilities: z.record(z.string(), z.boolean()),
});
export const sandboxResourceSchema = z.object({
	id: z.string(),
	kind: resourceKindSchema,
	target: z.string(),
	access: z.enum(["deny", "read", "readwrite"]),
	source: z.enum(["generic", "profile", "denial"]),
	tool: z.string().optional(),
	scope: resourceScopeSchema,
});
export const sandboxDenialSchema = z.object({
	id: z.string(),
	target: z.string(),
	resourceType: z.enum(["file", "ui", "network", "capability", "other"]),
	resource: sandboxResourceSchema.optional(),
	requestedAccess: z.string(),
	estimatedTool: z.string().optional(),
	actions: z
		.array(z.enum(["allow", "use-sandbox-cache", "deny"]))
		.default([]),
});
export const sandboxSnapshotSchema = z.object({
	selected: z.literal("mxc"),
	availability: z.array(sandboxAvailabilitySchema),
	grants: z.array(commandGrantSchema),
	resourceGrants: z.array(resourceGrantSchema),
	cacheSwitches: z.array(sandboxCacheSchema),
	resources: z.array(sandboxResourceSchema),
	denials: z.array(sandboxDenialSchema),
	reportStatus: z.enum(["not-run", "reported", "empty", "unavailable"]),
});
export type SandboxSnapshot = z.infer<typeof sandboxSnapshotSchema>;
export const sandboxRequestSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("ready") }).strict(),
	z.object({ type: z.literal("probe") }).strict(),
	z
		.object({
			type: z.literal("denial-action"),
			decision: resourceDecisionSchema,
		})
		.strict(),
	z
		.object({ type: z.literal("revoke-resource"), id: z.string().min(1) })
		.strict(),
	z
		.object({ type: z.literal("revoke-cache"), id: z.string().min(1) })
		.strict(),
	z
		.object({
			type: z.literal("revoke"),
			permission: commandPermissionKeySchema,
		})
		.strict(),
]);
export type SandboxRequest = z.infer<typeof sandboxRequestSchema>;
export const sandboxReplySchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("state"),
		state: sandboxSnapshotSchema,
		busy: z.boolean(),
	}),
	z.object({ type: z.literal("error"), message: z.string() }),
]);
export type SandboxReply = z.infer<typeof sandboxReplySchema>;
/** 実装と Storybook は同じ検証済みメッセージ契約を使う。 */
export type SandboxBridge = {
	postMessage(message: SandboxRequest): void;
	subscribe(listener: (reply: SandboxReply) => void): () => void;
};

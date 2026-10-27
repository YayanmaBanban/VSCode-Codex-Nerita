// 保存要求はパネルに固定したワークスペースで照合し、設定を保存する要求には世代も含める。
import { z } from "zod";
import { managerDraftSchema } from "./draft";
import { autoReviewConfigSchema } from "./autoReview";
import {
	agentEditSchema,
	backendSchema,
	handoffSchema,
	piDefaultsSchema,
} from "./config";

export const managedAgentSchema = z.strictObject({
	id: z.string(),
	definitionPath: z.string().optional(),
	backend: backendSchema,
	name: z.string(),
	description: z.string(),
	source: z.enum(["extension", "user", "project"]),
	aliases: z.array(z.string()),
	tools: z.array(z.string()),
	definitionModel: z.string().optional(),
	definitionThinking: z.string().optional(),
	edit: agentEditSchema,
	editable: z.boolean(),
	unavailableReason: z.string().optional(),
});
/** 保存元と編集可否を含むエージェントの表示情報。外部入力は `managedAgentSchema` で検証してから扱う。 */
export type ManagedAgent = z.infer<typeof managedAgentSchema>;
export const managerModelSchema = z.strictObject({
	value: z.string(),
	name: z.string(),
	efforts: z.array(z.string()).optional(),
});
/** エージェントに選択できるモデルと推論候補。外部入力は `managerModelSchema` で検証してから扱う。 */
export type ManagerModel = z.infer<typeof managerModelSchema>;
export const managerStateSchema = z.strictObject({
	type: z.literal("state"),
	workspace: z.string(),
	label: z.string(),
	generation: z.string(),
	agents: z.array(managedAgentSchema),
	piDefaults: piDefaultsSchema,
	piUserSettings: z.string(),
	modelScope: z.string(),
	handoff: handoffSchema,
	handoffExists: z.boolean(),
	handoffError: z.string().nullable(),
	autoReview: autoReviewConfigSchema.optional(),
	models: z.strictObject({
		pi: z.array(managerModelSchema),
		codex: z.array(managerModelSchema),
	}),
	activeBackend: backendSchema,
	currentModels: z
		.strictObject({
			pi: z.string().optional(),
			codex: z.string().optional(),
		})
		.optional(),
	currentEfforts: z
		.strictObject({
			pi: z.array(z.string()).optional(),
			codex: z.array(z.string()).optional(),
		})
		.optional(),
	running: z.number().int(),
	spawned: z.number().int(),
	errors: z.array(z.string()),
	draft: managerDraftSchema.nullable().optional(),
	draftError: z.string().nullable().optional(),
});
/** エージェント管理画面に渡す設定と世代。外部入力は `managerStateSchema` で検証してから扱う。 */
export type ManagerState = z.infer<typeof managerStateSchema>;
const mutation = {
	id: z.number().int(),
	workspace: z.string(),
	generation: z.string(),
};
export const managerRequestSchema = z.discriminatedUnion("type", [
	z.strictObject({
		type: z.literal("autoReview"),
		...mutation,
		backend: z.literal("pi"),
		config: autoReviewConfigSchema,
	}),
	z.strictObject({
		type: z.literal("draft"),
		id: z.number().int(),
		workspace: z.string(),
		draft: managerDraftSchema.nullable(),
	}),
	z.strictObject({
		type: z.literal("createAgent"),
		...mutation,
		backend: backendSchema,
		filename: z.string().regex(/^[a-z0-9][\w-]{0,79}$/i),
		edit: agentEditSchema,
	}),
	z.strictObject({ type: z.literal("ready") }),
	z.strictObject({ type: z.literal("reload") }),
	z.strictObject({ type: z.literal("viewer") }),
	z.strictObject({
		type: z.literal("agent"),
		...mutation,
		agentId: z.string(),
		edit: agentEditSchema,
	}),
	z.strictObject({
		type: z.literal("defaults"),
		...mutation,
		defaults: piDefaultsSchema,
	}),
	z.strictObject({
		type: z.literal("handoff"),
		...mutation,
		backend: backendSchema,
		config: handoffSchema,
	}),
]);
/** 設定の取得・保存、下書きの保存・破棄、チャット表示の要求。外部入力は `managerRequestSchema` で検証してから扱う。 */
export type ManagerRequest = z.infer<typeof managerRequestSchema>;
export const managerReplySchema = z.union([
	managerStateSchema,
	z.strictObject({
		type: z.literal("reply"),
		id: z.number().int(),
		error: z.string().nullable(),
		notice: z.string(),
	}),
]);
/** エージェント設定の状態または操作結果。外部入力は `managerReplySchema` で検証してから扱う。 */
export type ManagerReply = z.infer<typeof managerReplySchema>;
/** エージェント管理の通信境界。利用側は `subscribe` が返す解除関数を破棄時に呼び出す。 */
export type ManagerBridge = {
	postMessage: (message: ManagerRequest) => void;
	subscribe: (listener: (message: ManagerReply) => void) => () => void;
};

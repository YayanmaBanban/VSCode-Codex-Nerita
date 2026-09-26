// パネルに固定したワークスペースと世代を、すべての保存要求で照合する。
import { z } from "zod";
import {
	agentEditSchema,
	backendSchema,
	handoffSchema,
	piDefaultsSchema,
} from "./config";

export const managedAgentSchema = z.strictObject({
	id: z.string(),
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
export type ManagedAgent = z.infer<typeof managedAgentSchema>;
export const managerModelSchema = z.strictObject({
	value: z.string(),
	name: z.string(),
	efforts: z.array(z.string()).optional(),
});
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
	running: z.number().int(),
	spawned: z.number().int(),
	errors: z.array(z.string()),
});
export type ManagerState = z.infer<typeof managerStateSchema>;
const mutation = {
	id: z.number().int(),
	workspace: z.string(),
	generation: z.string(),
};
export const managerRequestSchema = z.discriminatedUnion("type", [
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
		config: handoffSchema,
	}),
]);
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
export type ManagerReply = z.infer<typeof managerReplySchema>;
export type ManagerBridge = {
	postMessage: (message: ManagerRequest) => void;
	subscribe: (listener: (message: ManagerReply) => void) => () => void;
};

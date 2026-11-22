// モバイルと Host が共有する Remote API の入出力を定義する。
import { z } from "zod";

export const remoteBodyBytes = 32 * 1024;
export const remoteStateBytes = 256 * 1024;
export const remoteTextLimit = 16384;

const backend = z.enum(["pi", "codex"]);
const id = z.string().min(1).max(256);
const operation = {
	requestId: z.uuid(),
	backendGeneration: z.int().nonnegative(),
};
const target = { ...operation, sessionId: id };
const sessionOperation = { ...operation, expectedSessionId: id.nullable() };
const turn = { ...target, runId: id };

export const remotePairSchema = z.strictObject({
	code: z.string().regex(/^\d{8}$/u),
});
export const remoteActionSchema = z.discriminatedUnion("type", [
	z.strictObject({ type: z.literal("session.list"), ...sessionOperation }),
	z.strictObject({ type: z.literal("session.new"), ...sessionOperation }),
	z.strictObject({
		type: z.literal("session.load"),
		...sessionOperation,
		sessionId: id,
	}),
	z.strictObject({
		type: z.literal("prompt.send"),
		...target,
		text: z
			.string()
			.max(remoteTextLimit)
			.refine((text) => text.trim().length > 0),
	}),
	z.strictObject({ type: z.literal("run.stop"), ...turn }),
	z.strictObject({
		type: z.literal("approval.respond"),
		...turn,
		permissionId: id,
		optionId: id,
	}),
	z.strictObject({
		type: z.literal("backend.select"),
		...operation,
		backend,
		expectedBackend: backend,
	}),
]);
/** リモートから要求できる操作を明示的に列挙する。 */
export type RemoteAction = z.infer<typeof remoteActionSchema>;

export const remoteStateSchema = z.strictObject({
	backend,
	backendGeneration: z.int().nonnegative(),
	revision: z.int().nonnegative(),
	connectionGeneration: z.uuid(),
	availableBackends: z
		.array(z.strictObject({ id: backend, selectable: z.boolean() }))
		.max(2),
	switching: z.boolean(),
	connection: z.enum([
		"disconnected",
		"connecting",
		"ready",
		"auth-required",
		"authenticating",
		"error",
	]),
	sessionId: id.nullable(),
	sessionTitle: z.string().max(256).nullable(),
	runId: id.nullable(),
	run: z.enum([
		"idle",
		"running",
		"cancelling",
		"completed",
		"cancelled",
		"failed",
	]),
	messages: z
		.array(
			z.strictObject({
				id,
				role: z.enum(["user", "assistant"]),
				text: z.string().max(remoteTextLimit),
				streaming: z.boolean(),
			}),
		)
		.max(50),
	tools: z
		.array(
			z.strictObject({
				id,
				title: z.string(),
				status: z.enum([
					"pending",
					"in_progress",
					"completed",
					"failed",
					"cancelled",
					"unfinished",
					"unknown",
				]),
			}),
		)
		.max(30),
	pendingApprovals: z
		.array(
			z.strictObject({
				id,
				title: z.string(),
				options: z
					.array(
						z.strictObject({ id, kind: z.enum(["allow", "deny"]) }),
					)
					.max(2),
			}),
		)
		.max(20),
	error: z
		.enum(["codex-unavailable", "pi-unavailable", "run-failed"])
		.nullable(),
	capabilities: z.strictObject({
		send: z.boolean(),
		stop: z.boolean(),
		approve: z.boolean(),
	}),
	truncated: z.boolean(),
	sessions: z
		.array(
			z.strictObject({
				id,
				title: z.string().max(256),
				updatedAt: z.string().max(64).optional(),
			}),
		)
		.max(30)
		.default([]),
	canManageSessions: z.boolean().default(false),
});
/** リモートに公開する全量状態。既存 UI の ChatState から独立する。 */
export type RemoteChatState = z.infer<typeof remoteStateSchema>;

export const remoteErrorSchema = z.strictObject({
	ok: z.literal(false),
	error: z.strictObject({
		code: z.enum([
			"invalid_request",
			"unauthenticated",
			"forbidden",
			"csrf_invalid",
			"stale_session",
			"stale_run",
			"stale_approval",
			"stale_backend",
			"backend_switch_busy",
			"payload_too_large",
			"too_many_requests",
			"host_unavailable",
			"backend_unavailable",
		]),
		message: z.string(),
	}),
});
/** 内部エラーの詳細を含まない公開コード。 */
export type RemoteErrorCode = z.infer<
	typeof remoteErrorSchema
>["error"]["code"];

export const remoteBootstrapSchema = z.strictObject({
	csrf: z.string().regex(/^[a-f0-9]{64}$/u),
	state: remoteStateSchema,
});

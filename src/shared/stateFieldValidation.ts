// スナップショット・差分・子エージェント表示で同じ状態フィールドの検証を使う。
import { isId, isRecord, everyRecord } from "./validation";
import { isMcpMessageContent } from "./mcp";
import { isPersonalitySettings } from "./personality";
import { validComposerField } from "./composerValidation";
import { isAsyncTask } from "./asyncTask";
import { isSubAgent } from "./subAgents";
import { isUiContributions } from "./uiContributionValidation";
import { isPiProviderControls } from "./piProviderControls";
import { isPermissionPresentation } from "./permission";

/** 差分通知に未知のフィールドが混入した場合も拒否する。 */
export function validStateField(key: string, value: unknown): boolean {
	const validator = stateFieldValidators.get(key);
	return validator ? validator(value) : validComposerField(key, value);
}

/** 各フィールドの検証を独立させ、未知のキーは受け付けない。 */
const stateFieldValidators = new Map<unknown, (value: unknown) => boolean>(
	Object.entries({
		piProviderControls: (value) =>
			value === null || isPiProviderControls(value),
		uiContributions: (value) => value === null || isUiContributions(value),
		agents: (value) => Array.isArray(value) && value.every(isSubAgent),
		personality: (value) => value === null || isPersonalitySettings(value),
		sessionTitle: (value) => value === null || typeof value === "string",
		piAccount: (value) => value === null || typeof value === "string",
		cwd: (value) => value === null || typeof value === "string",
		sessionsError: (value) => value === null || typeof value === "string",
		sessionsNextCursor: (value) =>
			value === null || typeof value === "string",
		sessionsLoading: (value) => typeof value === "boolean",
		sessionsArchived: (value) => typeof value === "boolean",
		sessionPending: (value) => typeof value === "boolean",
		sessionCapabilities: (value) =>
			isRecord(value) &&
			["list", "load", "fork", "delete"].every(
				(key) => typeof value[key] === "boolean",
			) &&
			["rename", "unarchive", "archive"].every(
				(key) =>
					value[key] === undefined || typeof value[key] === "boolean",
			),
		sessions: (value) =>
			everyRecord(
				value,
				(item) =>
					isId(item.sessionId) &&
					(item.archived === undefined ||
						typeof item.archived === "boolean") &&
					typeof item.cwd === "string" &&
					(item.title === undefined ||
						typeof item.title === "string") &&
					(item.updatedAt === undefined ||
						typeof item.updatedAt === "string"),
			),
		asyncTasks: (value) => Array.isArray(value) && value.every(isAsyncTask),
		connection: (value) =>
			[
				"disconnected",
				"connecting",
				"ready",
				"auth-required",
				"authenticating",
				"error",
			].includes(String(value)),
		run: (value) =>
			[
				"idle",
				"running",
				"cancelling",
				"completed",
				"cancelled",
				"failed",
			].includes(String(value)),
		sessionId: (value) => value === null || isId(value),
		runId: (value) => value === null || isId(value),
		planDecision: (value) =>
			value === null ||
			(isRecord(value) &&
				isId(value.runId) &&
				typeof value.text === "string"),
		error: (value) => value === null || typeof value === "string",
		messages: (value) =>
			everyRecord(
				value,
				(item) =>
					isId(item.id) &&
					["user", "assistant"].includes(String(item.role)) &&
					(item.streaming === undefined ||
						typeof item.streaming === "boolean") &&
					(item.mcp === undefined || isMcpMessageContent(item.mcp)) &&
					typeof item.text === "string",
			),
		tools: (value) =>
			everyRecord(
				value,
				(item) =>
					isId(item.id) &&
					typeof item.title === "string" &&
					(item.kind === undefined ||
						typeof item.kind === "string") &&
					(item.content === undefined ||
						Array.isArray(item.content)) &&
					[
						"pending",
						"in_progress",
						"completed",
						"failed",
						"cancelled",
					].includes(String(item.status)) &&
					Array.isArray(item.paths) &&
					item.paths.every((p: unknown) => typeof p === "string"),
			),
		permissions: (value) =>
			everyRecord(
				value,
				(item) =>
					isId(item.id) &&
					isPermissionPresentation(item) &&
					everyRecord(
						item.options,
						(o) =>
							isId(o.id) &&
							typeof o.name === "string" &&
							[
								"allow_once",
								"allow_always",
								"reject_once",
								"reject_always",
							].includes(String(o.kind)),
					),
			),
		authMethods: (value) =>
			everyRecord(
				value,
				(item) => isId(item.id) && typeof item.name === "string",
			),
		attachmentsSupported: (value) => typeof value === "boolean",
	} satisfies Record<string, (value: unknown) => boolean>),
);

// スナップショット・差分・子エージェント表示で同じ状態フィールドの検証を使う。
import { isId, isRecord, everyRecord } from "./validation";
import { isMcpMessageContent } from "./mcp";
import { isPersonalitySettings } from "./personality";
import { validComposerField } from "./composerValidation";
import { isAsyncTask } from "./asyncTask";
import { isSubAgent } from "./subAgents";

/** 差分通知に未知のフィールドが混入した場合も拒否する。 */
export function validStateField(key: string, value: unknown): boolean {
	switch (key) {
		case "agents":
			return Array.isArray(value) && value.every(isSubAgent);
		case "personality":
			return value === null || isPersonalitySettings(value);
		case "sessionTitle":
		case "cwd":
		case "sessionsError":
		case "sessionsNextCursor":
			return value === null || typeof value === "string";
		case "sessionsLoading":
		case "sessionsArchived":
		case "sessionPending":
			return typeof value === "boolean";
		case "sessionCapabilities":
			return (
				isRecord(value) &&
				["list", "load", "fork", "delete"].every(
					(key) => typeof value[key] === "boolean",
				) &&
				["rename", "unarchive", "archive"].every(
					(key) =>
						value[key] === undefined ||
						typeof value[key] === "boolean",
				)
			);
		case "sessions":
			return everyRecord(
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
			);
		case "asyncTasks":
			return Array.isArray(value) && value.every(isAsyncTask);
		case "connection":
			return [
				"disconnected",
				"connecting",
				"ready",
				"auth-required",
				"authenticating",
				"error",
			].includes(String(value));
		case "run":
			return [
				"idle",
				"running",
				"cancelling",
				"completed",
				"cancelled",
				"failed",
			].includes(String(value));
		case "sessionId":
		case "runId":
			return value === null || isId(value);
		case "error":
			return value === null || typeof value === "string";
		case "messages":
			return everyRecord(
				value,
				(item) =>
					isId(item.id) &&
					["user", "assistant"].includes(String(item.role)) &&
					(item.streaming === undefined ||
						typeof item.streaming === "boolean") &&
					(item.mcp === undefined || isMcpMessageContent(item.mcp)) &&
					typeof item.text === "string",
			);
		case "tools":
			return everyRecord(
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
			);
		case "permissions":
			return everyRecord(
				value,
				(item) =>
					isId(item.id) &&
					typeof item.title === "string" &&
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
			);
		case "authMethods":
			return everyRecord(
				value,
				(item) => isId(item.id) && typeof item.name === "string",
			);
		case "attachmentsSupported":
			return typeof value === "boolean";
		default:
			return validComposerField(key, value);
	}
}

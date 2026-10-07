// スナップショット・差分・子エージェント表示で同じ状態フィールドの検証を使う。
import { isId, isRecord, everyRecord } from "./validation";
import { validToolOutputPreview } from "./toolOutput";
import { isMcpMessageContent } from "./mcp";
import { isPersonalitySettings } from "./personality";
import { validComposerField } from "./composerValidation";
import { isAsyncTask } from "./asyncTask";
import { isSubAgent } from "./subAgents";
import { isUiContributions } from "./uiContributionValidation";
import { isPiProviderControls } from "./piProviderControls";
import { isPermissionPresentation } from "./permission";
import { validReferences } from "./composerReferences";
import type { ChatMessage, ToolSummary } from "./chatState";
import { isToolContent } from "./toolContent";

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
			typeof value === "string" &&
			[
				"disconnected",
				"connecting",
				"ready",
				"auth-required",
				"authenticating",
				"error",
			].includes(value),
		run: (value) =>
			typeof value === "string" &&
			[
				"idle",
				"running",
				"cancelling",
				"completed",
				"cancelled",
				"failed",
			].includes(value),
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
					typeof item.role === "string" &&
					["user", "assistant"].includes(item.role) &&
					typeof item.text === "string" &&
					validReferences(item.text, item.references) &&
					validOptionalFields(item, messageOptionalValidators),
			),
		tools: (value) =>
			everyRecord(
				value,
				(item) =>
					isId(item.id) &&
					typeof item.title === "string" &&
					validOptionalFields(item, toolOptionalValidators) &&
					[
						"pending",
						"in_progress",
						"completed",
						"failed",
						"cancelled",
						"unfinished",
						"unknown",
					].some((status) => status === item.status) &&
					Array.isArray(item.paths) &&
					item.paths.every((p: unknown) => typeof p === "string"),
			),
		permissions: (value) =>
			everyRecord(
				value,
				(item) =>
					isId(item.id) &&
					everyRecord(
						item.options,
						(o) =>
							isId(o.id) &&
							typeof o.name === "string" &&
							typeof o.kind === "string" &&
							["allow", "deny", "abort"].includes(o.kind),
					) &&
					isPermissionPresentation(item),
			),
		authMethods: (value) =>
			everyRecord(
				value,
				(item) => isId(item.id) && typeof item.name === "string",
			),
		attachmentsSupported: (value) => typeof value === "boolean",
	} satisfies Record<string, (value: unknown) => boolean>),
);

/** 宣言された任意フィールドを網羅し、追加時の検証漏れを型チェックで検出する。 */
type OptionalValidators<T> = {
	[K in keyof T as Record<never, never> extends Pick<T, K> ? K : never]-?: (
		value: unknown,
	) => boolean;
};
const messageOptionalValidators = {
	order: (value) => typeof value === "number" && Number.isFinite(value),
	references: () => true, // 本文との位置関係も含めて上で検証する。
	attachments: (value) => validComposerField("attachments", value),
	streaming: (value) => typeof value === "boolean",
	mcp: isMcpMessageContent,
} satisfies OptionalValidators<ChatMessage>;
const toolOptionalValidators = {
	output: validToolOutputPreview,
	exitCode: (value) =>
		typeof value === "number" && Number.isSafeInteger(value),
	cwd: (value) => typeof value === "string",
	backgrounded: (value) => typeof value === "boolean",
	order: (value) => typeof value === "number" && Number.isFinite(value),
	runId: isId,
	parentToolCallId: isId,
	summaryOnly: (value) => typeof value === "boolean",
	omittedArgumentBytes: validOmittedArgumentBytes,
	nestedCallsIncomplete: (value) => typeof value === "boolean",
	kind: (value) => typeof value === "string",
	content: (value) => Array.isArray(value) && value.every(isToolContent),
	commandOutput: (value) => typeof value === "string",
	searchLabel: (value) => typeof value === "string",
	resultDisplay: validResultDisplay,
	// 診断用の生データは任意の構造を保持する。
	rawInput: () => true,
	rawOutput: () => true,
	rawItem: () => true,
} satisfies OptionalValidators<ToolSummary>;

/** 未指定は許可し、既知の任意フィールドだけを検証する。未知キーと元参照は維持する。 */
function validOptionalFields(
	item: Record<string, unknown>,
	validators: Record<string, (value: unknown) => boolean>,
): boolean {
	return Object.entries(validators).every(
		([key, validate]) => item[key] === undefined || validate(item[key]),
	);
}

/** 表示用メタデータには、生の結果や任意フィールドを許可しない。 */
function validResultDisplay(value: unknown): boolean {
	return (
		value === undefined ||
		(isRecord(value) &&
			typeof value.source === "string" &&
			["content", "structuredContent"].includes(value.source) &&
			typeof value.omitted === "boolean" &&
			Object.keys(value).every(
				(key) => key === "source" || key === "omitted",
			))
	);
}

/** 省略サイズは非負の整数だけを受理する。 */
function validOmittedArgumentBytes(value: unknown) {
	return (
		value === undefined ||
		(typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
	);
}

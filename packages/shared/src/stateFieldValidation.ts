// スナップショット・差分・子エージェント表示で同じ状態フィールドの検証を使う。
import {
	isId,
	isRecord,
	everyRecord,
	isOptionalBoolean,
	isOptionalString,
} from "./validation";
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
import { isQuestionRequest } from "./questions";

/** 差分通知に未知のフィールドが混入した場合も拒否する。 */
export function validStateField(key: string, value: unknown): boolean {
	const validator = stateFieldValidators.get(key);
	return validator ? validator(value) : validComposerField(key, value);
}

/** 各フィールドの検証を独立させ、未知のキーは受け付けない。 */
const stateFieldValidators = new Map<unknown, (value: unknown) => boolean>(
	Object.entries({
		questions: (value) =>
			Array.isArray(value) && value.every(isQuestionRequest),
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
		sessionCapabilities: validSessionCapabilities,
		sessions: (value) => everyRecord(value, validSessionSummary),
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
		planDecision: (value) => {
			if (value === null) {
				return true;
			}
			return (
				isRecord(value) &&
				isId(value.runId) &&
				typeof value.text === "string"
			);
		},
		error: (value) => value === null || typeof value === "string",
		messages: (value) =>
			everyRecord(value, (item) => {
				if (!isId(item.id)) {
					return false;
				}
				if (!(typeof item.role === "string")) {
					return false;
				}
				if (!["user", "assistant"].includes(item.role)) {
					return false;
				}
				return (
					typeof item.text === "string" &&
					validReferences(item.text, item.references) &&
					validOptionalFields(item, messageOptionalValidators)
				);
			}),
		tools: (value) =>
			everyRecord(value, (item) => {
				if (!isId(item.id)) {
					return false;
				}
				if (!(typeof item.title === "string")) {
					return false;
				}
				if (!validOptionalFields(item, toolOptionalValidators)) {
					return false;
				}
				return (
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
					item.paths.every((p: unknown) => typeof p === "string")
				);
			}),
		permissions: (value) =>
			everyRecord(
				value,
				(item) =>
					isId(item.id) &&
					everyRecord(item.options, (o) => {
						if (!isId(o.id)) {
							return false;
						}
						if (!(typeof o.name === "string")) {
							return false;
						}
						if (!(typeof o.kind === "string")) {
							return false;
						}
						return ["allow", "deny", "abort"].includes(o.kind);
					}) &&
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
	const matchesEvery = Object.entries(validators).every(
		([key, validate]) => item[key] === undefined || validate(item[key]),
	);
	return matchesEvery;
}

/** 表示用メタデータには、生の結果や任意フィールドを許可しない。 */
function validResultDisplay(value: unknown): boolean {
	if (value === undefined) {
		return true;
	}

	if (!isRecord(value)) {
		return false;
	}
	if (!(typeof value.source === "string")) {
		return false;
	}
	if (!["content", "structuredContent"].includes(value.source)) {
		return false;
	}
	const matchesOmitted =
		typeof value.omitted === "boolean" &&
		Object.keys(value).every(
			(key) => key === "source" || key === "omitted",
		);
	return matchesOmitted;
}

/** 省略サイズは非負の整数だけを受理する。 */
function validOmittedArgumentBytes(value: unknown) {
	if (value === undefined) {
		return true;
	}
	return (
		typeof value === "number" && Number.isSafeInteger(value) && value >= 0
	);
}

/** 履歴の識別子・作業先・任意の表示値を検証し、空の識別子と別の型を拒否する。 */
function validSessionSummary(item: Record<string, unknown>): boolean {
	if (!isId(item.sessionId)) {
		return false;
	}
	if (!isOptionalBoolean(item.archived)) {
		return false;
	}

	if (typeof item.cwd !== "string") {
		return false;
	}
	if (!isOptionalString(item.title)) {
		return false;
	}
	return isOptionalString(item.updatedAt);
}

/** 基本操作は必須フラグとして検証し、追加操作は未指定または明示した真偽値だけを受け付ける。 */
function validSessionCapabilities(value: unknown): boolean {
	if (!isRecord(value)) {
		return false;
	}
	const requiredFlags = ["list", "load", "fork", "delete"].every(
		(key) => typeof value[key] === "boolean",
	);
	if (!requiredFlags) {
		return false;
	}
	return ["rename", "unarchive", "archive"].every((key) =>
		isOptionalBoolean(value[key]),
	);
}

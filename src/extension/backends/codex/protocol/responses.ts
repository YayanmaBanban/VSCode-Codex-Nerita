// 利用する RPC の生成型と、受信データの実行時検証を結び付ける。
import { parseSandboxConfig } from "./config";
import type { ClientRequest } from "../codex-app-server/ClientRequest";
import type { CollaborationMode } from "../codex-app-server/CollaborationMode";
import type { InitializeResponse } from "../codex-app-server/InitializeResponse";
import type { ThreadLoadedListResponse } from "../codex-app-server/v2/ThreadLoadedListResponse";
import { isRecord } from "../../../../shared/validation";
import { parseSkills } from "./skills";
import { parseMcpStatus } from "../mcpStatus";
import { parseModels, parseLogin } from "./account";
import { parseQuotaResponse } from "./usage";
import {
	parseCommandResult,
	parseSandboxReadiness,
	parseSandboxSetup,
} from "./command";
import {
	parseThreads,
	parseTurns,
	parseItems,
	parseReadThread,
	parseResumedThread,
} from "./history";
import {
	parseStartedThread,
	parseStartedTurn,
	parseSteeredTurn,
	parseInterrupt,
	parseAccount,
} from "./turn";

/** 対応済みメソッドだけを公開し、応答の生成型を固定する。 */
export type AppServerResponses = {
	"config/read": ReturnType<typeof parseSandboxConfig>;
	"command/exec": ReturnType<typeof parseCommandResult>;
	"command/exec/terminate": Record<string, never>;
	"windowsSandbox/readiness": ReturnType<typeof parseSandboxReadiness>;
	"windowsSandbox/setupStart": ReturnType<typeof parseSandboxSetup>;
	"thread/settings/update": Record<string, never>;
	"mcpServerStatus/list": ReturnType<typeof parseMcpStatus>;
	"skills/list": ReturnType<typeof parseSkills>;
	"thread/list": ReturnType<typeof parseThreads>;
	"thread/read": ReturnType<typeof parseReadThread>;
	"thread/resume": ReturnType<typeof parseResumedThread>;
	"thread/fork": ReturnType<typeof parseResumedThread>;
	"thread/turns/list": ReturnType<typeof parseTurns>;
	"thread/items/list": ReturnType<typeof parseItems>;
	"thread/name/set": Record<string, never>;
	"thread/archive": Record<string, never>;
	"thread/delete": Record<string, never>;
	"thread/unarchive": ReturnType<typeof parseReadThread>;
	"model/list": ReturnType<typeof parseModels>;
	"account/login/start": ReturnType<typeof parseLogin>;
	"account/login/cancel": { status: string };
	"account/logout": Record<string, never>;
	"account/rateLimits/read": ReturnType<typeof parseQuotaResponse>;
	"thread/start": ReturnType<typeof parseStartedThread>;
	"turn/start": ReturnType<typeof parseStartedTurn>;
	"turn/steer": ReturnType<typeof parseSteeredTurn>;
	"turn/interrupt": ReturnType<typeof parseInterrupt>;
	"account/read": ReturnType<typeof parseAccount>;
	initialize: InitializeResponse;
	"thread/loaded/list": ThreadLoadedListResponse;
};
/** メソッド名から生成済みの要求パラメーターを選ぶ。 */
export type AppServerParams<M extends keyof AppServerResponses> =
	M extends "thread/settings/update"
		? { threadId: string; collaborationMode: CollaborationMode }
		: Extract<ClientRequest, { method: M }>["params"];
/** 初期化の応答を必要な全フィールドについて検証する。 */
function initializeResponse(value: unknown): InitializeResponse {
	if (
		!isRecord(value) ||
		typeof value.userAgent !== "string" ||
		typeof value.codexHome !== "string" ||
		typeof value.platformFamily !== "string" ||
		typeof value.platformOs !== "string"
	) {
		throw new Error("Codex の初期化応答が不正です。");
	}
	return {
		userAgent: value.userAgent,
		codexHome: value.codexHome,
		platformFamily: value.platformFamily,
		platformOs: value.platformOs,
	};
}
/** 読み取り専用の接続確認応答を検証する。 */
function loadedThreadsResponse(value: unknown): ThreadLoadedListResponse {
	if (
		!isRecord(value) ||
		!Array.isArray(value.data) ||
		!value.data.every((id: unknown) => typeof id === "string") ||
		!(value.nextCursor === null || typeof value.nextCursor === "string")
	) {
		throw new Error("Codex の読み込み済みスレッド一覧が不正です。");
	}
	return { data: value.data, nextCursor: value.nextCursor };
}
/** RPC と検証関数の対応を型検査し、未検証の result を公開しない。 */
export const responseParsers: {
	[M in keyof AppServerResponses]: (value: unknown) => AppServerResponses[M];
} = {
	"config/read": parseSandboxConfig,
	"command/exec": parseCommandResult,
	"command/exec/terminate": parseInterrupt,
	"windowsSandbox/readiness": parseSandboxReadiness,
	"windowsSandbox/setupStart": parseSandboxSetup,
	"thread/settings/update": parseInterrupt,
	"mcpServerStatus/list": parseMcpStatus,
	"skills/list": parseSkills,
	"thread/list": parseThreads,
	"thread/read": parseReadThread,
	"thread/resume": parseResumedThread,
	"thread/fork": parseResumedThread,
	"thread/turns/list": parseTurns,
	"thread/items/list": parseItems,
	"thread/name/set": parseInterrupt,
	"thread/archive": parseInterrupt,
	"thread/delete": parseInterrupt,
	"thread/unarchive": parseReadThread,
	"model/list": parseModels,
	"account/login/start": parseLogin,
	"account/logout": parseInterrupt,
	"account/login/cancel": (value) => {
		if (!isRecord(value) || typeof value.status !== "string") {
			throw new Error("Invalid login cancellation");
		}
		return { status: value.status };
	},
	"account/rateLimits/read": parseQuotaResponse,
	"thread/start": parseStartedThread,
	"turn/start": parseStartedTurn,
	"turn/steer": parseSteeredTurn,
	"turn/interrupt": parseInterrupt,
	"account/read": parseAccount,
	initialize: initializeResponse,
	"thread/loaded/list": loadedThreadsResponse,
};

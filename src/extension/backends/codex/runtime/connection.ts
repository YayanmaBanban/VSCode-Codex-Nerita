// 会話制御が必要とする接続操作と、起動・取消の注入契約。
import type { CodexClient } from "../CodexClient";
import type { AppServerCallbacks } from "./AppServerTransport";

/** 状態管理に必要な App Server 操作だけを注入する境界。 */
export type CodexConnection = Pick<
	CodexClient,
	| "startThread"
	| "startTurn"
	| "updateCollaborationMode"
	| "steerTurn"
	| "interruptTurn"
	| "readAccount"
	| "dispose"
	| "listModels"
	| "listMcpServerStatus"
	| "readRateLimits"
	| "login"
	| "cancelLogin"
	| "logout"
	| "listThreads"
	| "readThread"
	| "resumeThread"
	| "forkThread"
	| "listTurns"
	| "listItems"
	| "renameThread"
	| "archiveThread"
	| "deleteThread"
	| "unarchiveThread"
> &
	Partial<
		Pick<
			CodexClient,
			"readPersonality" | "changePersonality" | "listSkills"
		>
	>;
/** 起動前のワークスペース検証と、取消可能な接続を提供する。 */
export type CodexFactory = (
	callbacks: AppServerCallbacks,
	signal: AbortSignal,
) => Promise<{ client: CodexConnection; cwd: string }>;

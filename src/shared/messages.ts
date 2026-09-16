// Host とブラウザの通信契約。VS Code・Node.js・サーバープロトコルに依存しない。
import type {
	Attachment,
	ComposerMessage,
	ConfigOption,
	ContextUsage,
	QuotaWindow,
} from "./composer";
import type { AsyncTask } from "./asyncTask";
import type {
	SessionSummary,
	SessionCapabilities,
	SessionHistoryMessage,
} from "./sessionHistory";
/** 接続の表示状態。 */
export type ConnectionStatus =
	| "disconnected"
	| "connecting"
	| "ready"
	| "auth-required"
	| "authenticating"
	| "error";
/** 一つのプロンプトの実行状態。 */
export type RunStatus =
	"idle" | "running" | "cancelling" | "completed" | "cancelled" | "failed";
/** 会話に表示するテキスト。 */
export type ChatMessage = {
	id: string;
	order?: number;
	role: "user" | "assistant";
	text: string;
};
/** ツール実行・変更ファイルの概要。 */
export type ToolSummary = {
	id: string;
	cwd?: string;
	backgrounded?: boolean;
	order?: number;
	runId?: string;
	title: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	paths: string[];
	kind?: string;
	content?: unknown[];
	rawInput?: unknown;
	rawOutput?: unknown;
};
/** エージェントが提示した承認選択肢。 */
export type PermissionOption = {
	id: string;
	name: string;
	kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
};
/** 一度だけ回答できる承認要求。 */
export type Permission = {
	id: string;
	title: string;
	options: PermissionOption[];
};
/** Host が保持する現在の会話の正本。 */
export type ChatState = {
	revision: number;
	connection: ConnectionStatus;
	sessionId: string | null;
	sessionTitle: string | null;
	runId: string | null;
	run: RunStatus;
	messages: ChatMessage[];
	tools: ToolSummary[];
	asyncTasks: AsyncTask[];
	permissions: Permission[];
	error: string | null;
	authMethods: { id: string; name: string }[];
	configOptions: ConfigOption[];
	configPending: boolean;
	usage: ContextUsage | null;
	quota: QuotaWindow[] | null;
	attachments: Attachment[];
	attachmentPending: boolean;
	attachmentsSupported: boolean;
	cwd: string | null;
	sessions: SessionSummary[];
	sessionCapabilities: SessionCapabilities;
	sessionsLoading: boolean;
	sessionsArchived: boolean;
	sessionsNextCursor: string | null;
	sessionsError: string | null;
	sessionPending: boolean;
};
/** UI が送れる操作を限定する判別共用体。 */
export type UiMessage =
	| ComposerMessage
	| SessionHistoryMessage
	| { type: "ui/ready" }
	| { type: "ui/openEditor" | "ui/openSidebar"; requestId: string }
	| { type: "ui/saveDraft"; requestId: string; draft: string }
	| { type: "ui/saveScroll"; requestId: string; scrollTop: number }
	| { type: "connection/retry"; requestId: string }
	| { type: "session/new"; requestId: string }
	| { type: "auth/start"; requestId: string; methodId: string }
	| {
			type: "prompt/send";
			requestId: string;
			sessionId: string;
			text: string;
	  }
	| {
			type: "prompt/cancel";
			requestId: string;
			sessionId: string;
			runId: string;
	  }
	| {
			type: "execution/stop";
			requestId: string;
			sessionId: string;
			runId: string;
			toolId: string;
	  }
	| {
			type: "permission/respond";
			requestId: string;
			sessionId: string;
			runId: string;
			permissionId: string;
			optionId: string;
	  };
/** 初期復元・以後の差分・個別要求の失敗を通知する。 */
export type HostMessage =
	| {
			type: "ui/viewState";
			editor: boolean;
			draft: string;
			scrollTop: number;
			restoreScroll: boolean;
	  }
	| { type: "state/snapshot"; state: ChatState }
	| {
			type: "state/patch";
			revision: number;
			patch: Partial<Omit<ChatState, "revision">>;
	  }
	| { type: "request/failed"; requestId: string; error: string };
/** 新しい Host と代替 Bridge に共通の初期状態を作る。 */
export function initialState(): ChatState {
	return {
		revision: 0,
		connection: "disconnected",
		sessionId: null,
		sessionTitle: null,
		runId: null,
		run: "idle",
		messages: [],
		tools: [],
		asyncTasks: [],
		permissions: [],
		error: null,
		authMethods: [],
		configOptions: [],
		configPending: false,
		usage: null,
		quota: null,
		attachments: [],
		attachmentPending: false,
		attachmentsSupported: true,
		cwd: null,
		sessions: [],
		sessionCapabilities: {
			list: false,
			load: false,
			fork: false,
			delete: false,
		},
		sessionsLoading: false,
		sessionsArchived: false,
		sessionsNextCursor: null,
		sessionsError: null,
		sessionPending: false,
	};
}

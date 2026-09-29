// Host が保持し Webview へ同期する会話状態と、両側で使う初期値を定義する。
import type { McpMessageContent } from "./mcp";
import type { PermissionPresentation } from "./permission";
import type { ComposerReference } from "./composerReferences";
import type { PiProviderControls } from "./piProviderControls";
import type { UiContributions } from "./uiContributions";
import type { SkillSummary } from "./skills";
import type { PersonalitySettings } from "./personality";
import type {
	Attachment,
	ConfigOption,
	ContextUsage,
	QuotaWindow,
} from "./composer";
import type { AsyncTask } from "./asyncTask";
import type { SubAgentSummary } from "./subAgents";
import type { SessionSummary, SessionCapabilities } from "./sessionHistory";

/** 接続の表示状態。 */
export type ConnectionStatus =
	| "disconnected"
	| "connecting"
	| "ready"
	| "auth-required"
	| "authenticating"
	| "error";

/** 1つのプロンプトの実行状態。 */
export type RunStatus =
	"idle" | "running" | "cancelling" | "completed" | "cancelled" | "failed";

/** 会話に表示するテキスト。 */
export type ChatMessage = {
	id: string;
	order?: number;
	role: "user" | "assistant";
	text: string;
	references?: ComposerReference[];
	streaming?: boolean;
	mcp?: McpMessageContent;
};

/** ツール実行・変更ファイルの概要。 */
export type ToolSummary = {
	id: string;
	cwd?: string;
	backgrounded?: boolean;
	order?: number;
	runId?: string;
	title: string;
	status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
	paths: string[];
	kind?: string;
	content?: unknown[];
	rawInput?: unknown;
	rawOutput?: unknown;
	/** 正規化で省略されるフィールドも調査できるよう、受信項目を保持する。 */
	rawItem?: unknown;
};

/** エージェントが提示した承認選択肢。 */
export type PermissionOption = {
	id: string;
	name: string;
	kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
};

/** 一度だけ回答できる承認要求。 */
export type Permission = PermissionPresentation & {
	id: string;
	options: PermissionOption[];
};

/** Host が保持する現在の会話の正本。 */
export type ChatState = {
	/** `null` は Host から定義を受信する前。両バックエンドとも解決済み定義を公開する。 */
	uiContributions: UiContributions | null;
	skills: SkillSummary[];
	personality: PersonalitySettings | null;
	revision: number;
	connection: ConnectionStatus;
	sessionId: string | null;
	sessionTitle: string | null;
	runId: string | null;
	run: RunStatus;
	/** 完了した Plan の選択待ち。 */
	planDecision: { runId: string; text: string } | null;
	messages: ChatMessage[];
	tools: ToolSummary[];
	agents: SubAgentSummary[];
	asyncTasks: AsyncTask[];
	permissions: Permission[];
	error: string | null;
	authMethods: { id: string; name: string }[];
	piAccount: string | null;
	piProviderControls: PiProviderControls | null;
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

/** 新しい Host と代替 Bridge に共通の初期状態を作る。 */
export function initialState(): ChatState {
	return {
		uiContributions: null,
		skills: [],
		personality: null,
		revision: 0,
		connection: "disconnected",
		sessionId: null,
		sessionTitle: null,
		runId: null,
		run: "idle",
		planDecision: null,
		messages: [],
		tools: [],
		agents: [],
		asyncTasks: [],
		permissions: [],
		error: null,
		authMethods: [],
		piAccount: null,
		piProviderControls: null,
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

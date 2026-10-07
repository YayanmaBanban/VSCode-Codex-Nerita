// Host が保持し Webview へ同期する会話状態と、両側で使う初期値を定義する。
import type { McpMessageContent } from "./mcp";
import type { ToolContent } from "./toolContent";
import type { ToolOutputPreview } from "./toolOutput";
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

/** 1 つのプロンプトの実行状態。 */
export type RunStatus =
	"idle" | "running" | "cancelling" | "completed" | "cancelled" | "failed";

/** 会話に表示するテキスト。 */
export type ChatMessage = {
	id: string;
	order?: number;
	role: "user" | "assistant";
	text: string;
	references?: ComposerReference[];
	/** 送信後も表示する添付。入力欄の添付とは独立して保持する。 */
	attachments?: Attachment[];
	streaming?: boolean;
	mcp?: McpMessageContent;
};

/** ツール実行・変更ファイルの概要。 */
export type ToolSummary = {
	output?: ToolOutputPreview;
	exitCode?: number;
	id: string;
	cwd?: string;
	backgrounded?: boolean;
	order?: number;
	runId?: string;
	/** このツールを呼び出した、同じ実行内の親ツールの ID。 */
	parentToolCallId?: string;
	/** 子ツールの保存履歴は結果本文を持たず、要約だけを復元する。 */
	summaryOnly?: boolean;
	omittedArgumentBytes?: number;
	nestedCallsIncomplete?: boolean;
	title: string;
	status:
		| "pending"
		| "in_progress"
		| "completed"
		| "failed"
		| "cancelled"
		| "unfinished"
		| "unknown";
	paths: string[];
	kind?: string;
	content?: ToolContent[];
	/** 専用カードが表示する情報は Host で正規化し、生データから分離する。 */
	commandOutput?: string;
	searchLabel?: string;
	/** Host が整形した結果の表示元と、省略の有無。 */
	resultDisplay?: {
		source: "content" | "structuredContent";
		omitted: boolean;
	};
	rawInput?: unknown;
	rawOutput?: unknown;
	/** 正規化で省略されるフィールドも調査できるよう、受信項目を保持する。 */
	rawItem?: unknown;
};

/** エージェントが提示した承認選択肢。 */
export type PermissionOption = {
	id: string;
	name: string;
	/** ボタンの表示分類。選択した `id` をバックエンドへ返して承認判断に使う。 */
	kind: "allow" | "deny" | "abort";
};

/** 一度だけ回答できる承認要求。 */
export type Permission = PermissionPresentation & {
	id: string;
	options: PermissionOption[];
};

/** Host が管理し、Webview へ同期する現在の会話状態。 */
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

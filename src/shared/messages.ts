// HostとWebviewの要求・通知の通信契約を定義し、実行環境のAPIに依存させない。
import type { ChatState } from "./chatState";
import type { ComposerPart } from "./composerContent";
import type { ChangeScope } from "./changeReferences";
import type {
	SessionReferencesRequest,
	SessionReferencesResult,
	SessionReferenceOpen,
} from "./sessionReferences";
import type { SourceRange } from "./symbolLocation";
import type {
	WorkspaceSymbolsRequest,
	WorkspaceSymbolsResult,
} from "./workspaceSymbols";
import type {
	WorkspacePathsRequest,
	WorkspacePathsResult,
	ResolvePathRequest,
	ResolvePathResult,
} from "./workspacePaths";
import type { SidebarLocation } from "./sidebar";
import type { PersonalityMessage } from "./personality";
import type { ComposerMessage } from "./composer";
import type { AgentThreadView } from "./subAgents";
import type { SessionHistoryMessage } from "./sessionHistory";

/** UI が送れる操作を限定する判別共用体。 */
export type UiMessage =
	| {
			type: "agent/read";
			requestId: string;
			sessionId: string;
			threadId: string;
	  }
	| SessionReferencesRequest
	| SessionReferenceOpen
	| {
			type: "reference/open";
			requestId: string;
			uri: string;
			range?: SourceRange;
	  }
	| WorkspaceSymbolsRequest
	| WorkspacePathsRequest
	| ResolvePathRequest
	| { type: "ui/setSidebar"; requestId: string; location: SidebarLocation }
	| PersonalityMessage
	| ComposerMessage
	| SessionHistoryMessage
	| { type: "ui/ready" }
	| { type: "ui/openEditor" | "ui/openSidebar"; requestId: string }
	| {
			type: "ui/saveDraft";
			requestId: string;
			draft: string;
			draftParts?: ComposerPart[];
	  }
	| { type: "ui/saveScroll"; requestId: string; scrollTop: number }
	| { type: "connection/retry"; requestId: string }
	| { type: "session/new"; requestId: string }
	| {
			type: "changes/open";
			requestId: string;
			scope: ChangeScope;
	  }
	| { type: "auth/start"; requestId: string; methodId: string }
	| { type: "auth/logout"; requestId: string }
	| {
			type: "prompt/send";
			requestId: string;
			sessionId: string;
			text: string;
			referencedSessionIds?: string[];
			changeScopes?: ChangeScope[];
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
	| { type: "ui/codeBlock"; requestId: string }
	| { type: "agent/view"; requestId: string; view: AgentThreadView }
	| SessionReferencesResult
	| WorkspaceSymbolsResult
	| WorkspacePathsResult
	| ResolvePathResult
	| { type: "ui/sidebarState"; location: SidebarLocation }
	| { type: "prompt/accepted"; requestId: string; mode: "start" | "steer" }
	| {
			type: "ui/viewState";
			editor: boolean;
			draft: string;
			draftParts?: ComposerPart[];
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

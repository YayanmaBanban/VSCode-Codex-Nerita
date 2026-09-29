// セッション一覧の表示情報と利用可能な操作を Host・Webview で共有する。

/** 会話本文を含まない履歴の概要。 */
export type SessionSummary = {
	sessionId: string;
	cwd: string;
	title?: string;
	updatedAt?: string;
	archived?: boolean;
};

/** 接続先が公開する履歴操作の対応状況。 */
export type SessionCapabilities = {
	list: boolean;
	load: boolean;
	fork: boolean;
	delete: boolean;
	archive?: boolean;
	rename?: boolean;
	unarchive?: boolean;
};

/** 現在の会話とは独立した履歴操作。 */
export type SessionHistoryMessage =
	| {
			type: "session/list";
			requestId: string;
			archived?: boolean;
			more?: boolean;
	  }
	| {
			type: "session/rename";
			requestId: string;
			sessionId: string;
			name: string;
	  }
	| { type: "session/unarchive"; requestId: string; sessionId: string }
	| {
			[
				Type in
					| "session/load"
					| "session/fork"
					| "session/delete"
					| "session/archive"
			]: {
				type: Type;
				requestId: string;
				sessionId: string;
			};
	  }["session/load" | "session/fork" | "session/delete" | "session/archive"];

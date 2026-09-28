// Pi の復元済み会話と一覧の固定データ。
import type { ChatState } from "../../../shared/chatState";
import { piState } from "./pi";
/** 読み込まれた会話の表示を作る。永続化や分岐は扱わない。 */
export function piHistoryState(): ChatState {
	const cwd = "workspace/会話履歴を保存するプロジェクト";
	return {
		...piState(),
		cwd,
		sessionId: "pi-saved",
		sessionTitle: "Piの設定ファイルを確認した会話",
		sessionCapabilities: {
			list: true,
			load: true,
			fork: true,
			delete: false,
		},
		sessions: [
			{
				sessionId: "pi-saved",
				cwd,
				title: "Piの設定ファイルを確認した会話",
				updatedAt: "2026-09-01T00:00:00Z",
			},
			{
				sessionId: "pi-missing",
				cwd,
				title: "削除された履歴ファイル",
				updatedAt: "2026-09-01T00:00:00Z",
			},
		],
		messages: [
			{
				id: "saved-user",
				role: "user",
				text: "設定ファイルを確認してください。",
				order: 1,
			},
			{
				id: "saved-assistant",
				role: "assistant",
				text: "保存した会話を復元しました。",
				order: 3,
			},
		],
		tools: [
			{
				id: "saved-read",
				runId: "saved-run",
				title: "ファイルを読む: config.json",
				kind: "read",
				status: "completed",
				paths: ["config.json"],
				order: 2,
				content: [
					{
						type: "content",
						content: {
							type: "text",
							text: '{ "enabled": true }',
						},
					},
				],
			},
			{
				id: "saved-write",
				runId: "saved-run",
				title: "ファイルを書き込む: config.json",
				kind: "edit",
				status: "cancelled",
				paths: ["config.json"],
				order: 4,
				content: [
					{
						type: "content",
						content: {
							type: "text",
							text: "処理を停止しました。",
						},
					},
				],
			},
		],
	};
}

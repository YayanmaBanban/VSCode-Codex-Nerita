// Piの保存履歴を既存の一覧・会話UIで確認する。永続化は実SDKテストで検証する。
import { createMockBridge } from "./mockBridge";

/** 復元成功・失敗・未完了ツールと継続送信を再現する。 */
export function createPiHistoryBridge() {
	const bridge = createMockBridge();
	const cwd = "D:/workspace/会話履歴を保存するプロジェクト";
	const capabilities = { list: true, load: true, fork: false, delete: false };
	const sessions = [
		{
			sessionId: "pi-saved",
			cwd,
			title: "Piの設定ファイルを確認した会話",
			updatedAt: new Date().toISOString(),
		},
		{
			sessionId: "pi-missing",
			cwd,
			title: "削除された履歴ファイル",
			updatedAt: new Date().toISOString(),
		},
	];
	bridge.patchState({
		sessionTitle: "Pi",
		cwd,
		attachmentsSupported: false,
		configOptions: [],
		sessionCapabilities: capabilities,
	});
	return {
		...bridge,
		postMessage(message: Parameters<typeof bridge.postMessage>[0]) {
			if (message.type === "session/list") {
				bridge.patchState({
					sessions,
					sessionsLoading: false,
					sessionsError: null,
				});
			} else if (message.type === "session/load") {
				if (message.sessionId === "pi-missing") {
					bridge.patchState({
						sessionsError:
							"Piの履歴が見つかりません。一覧を更新してください。",
					});
					return;
				}
				bridge.patchState({
					sessionId: "pi-saved",
					sessionTitle: sessions[0]!.title,
					run: "idle",
					runId: null,
					permissions: [],
					sessionsError: null,
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
				});
			} else {
				bridge.postMessage(message);
				if (message.type === "session/new") {
					bridge.patchState({
						sessionTitle: "Pi",
						cwd,
						sessionCapabilities: capabilities,
						configOptions: [],
						attachmentsSupported: false,
					});
				}
			}
		},
	};
}

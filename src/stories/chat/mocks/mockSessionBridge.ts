// セッション一覧の遅延・失敗と各操作を Storybook 内で再現する。
import type { SessionSummary } from "../../../shared/sessionHistory";
import { createMockBridge } from "./mockBridge";

/** 履歴ペインの観察開始状態。 */
export type SessionScenario =
	"history" | "empty" | "error" | "unsupported" | "paginated";
/** 作業フォルダのセッション管理に対応する代替 Bridge を作る。 */
export function createSessionBridge(scenario: SessionScenario) {
	const bridge = createMockBridge();
	const cwd =
		"D:\\Developments\\workspace\\vscode-codex-acp\\とても長いフォルダ名のプロジェクト";
	const sessions: SessionSummary[] =
		scenario === "empty"
			? []
			: [
					{
						sessionId: "recent",
						cwd,
						title: "セッション一覧と履歴の読み込みを実装",
						updatedAt: new Date(Date.now() - 120000).toISOString(),
					},
					{
						sessionId: "older",
						cwd,
						title: "長いセッションタイトルでも操作ボタンが隠れず、更新日時を確認できること",
						updatedAt: new Date(
							Date.now() - 10800000,
						).toISOString(),
					},
					{ sessionId: "untitled", cwd },
				];
	const capabilities = {
		list: scenario !== "unsupported",
		load: true,
		fork: true,
		delete: true,
		archive: true,
		rename: true,
		unarchive: true,
	};
	let archived = false;
	let limit = scenario === "paginated" ? 2 : 50;
	bridge.patchState({ cwd, sessionCapabilities: capabilities });
	const timers = new Set<ReturnType<typeof setTimeout>>();
	/** 取得が完了した状態を遅らせて配信する。 */
	const refresh = () => {
		bridge.patchState({ sessionsLoading: true, sessionsError: null });
		timers.add(
			setTimeout(
				() =>
					bridge.patchState({
						sessionsLoading: false,
						sessions: sessions
							.filter((item) => !!item.archived === archived)
							.slice(0, limit),
						sessionsArchived: archived,
						sessionsNextCursor:
							sessions.filter(
								(item) => !!item.archived === archived,
							).length > limit
								? "next"
								: null,
						sessionsError:
							scenario === "error"
								? "セッション一覧を取得できませんでした。再試行してください。"
								: scenario === "unsupported"
									? "この接続先はセッション一覧に対応していません。"
									: null,
					}),
				700,
			),
		);
	};
	return {
		...bridge,
		subscribe(listener: Parameters<typeof bridge.subscribe>[0]) {
			const unsubscribe = bridge.subscribe(listener);
			return () => {
				unsubscribe();
				timers.forEach(clearTimeout);
				timers.clear();
			};
		},
		postMessage(message: Parameters<typeof bridge.postMessage>[0]) {
			if (message.type === "session/list") {
				bridge.sent.push(message);
				archived = message.archived ?? archived;
				if (message.more) {
					limit += 2;
				}
				refresh();
				return;
			}
			if (message.type === "session/new") {
				bridge.postMessage(message);
				const sessionId = crypto.randomUUID();
				sessions.unshift({
					sessionId,
					cwd,
					title: "新しいセッション",
					updatedAt: new Date().toISOString(),
				});
				bridge.patchState({
					cwd,
					sessionId,
					sessionCapabilities: capabilities,
				});
				refresh();
				return;
			}
			if (
				message.type === "session/delete" ||
				message.type === "session/archive" ||
				message.type === "session/rename" ||
				message.type === "session/unarchive" ||
				message.type === "session/fork" ||
				message.type === "session/load"
			) {
				bridge.sent.push(message);
				const item = sessions.find(
					(session) => session.sessionId === message.sessionId,
				);
				if (!item) {
					return;
				}
				if (message.type === "session/delete") {
					sessions.splice(sessions.indexOf(item), 1);
				} else if (message.type === "session/archive") {
					item.archived = true;
				} else if (message.type === "session/unarchive") {
					item.archived = false;
				} else if (message.type === "session/rename") {
					item.title = message.name;
				} else {
					const target =
						message.type === "session/fork"
							? {
									...item,
									sessionId: crypto.randomUUID(),
									title: `${item.title}（フォーク）`,
									updatedAt: new Date().toISOString(),
								}
							: item;
					if (target !== item) {
						sessions.unshift(target);
					}
					bridge.patchState({
						sessionId: target.sessionId,
						messages: [
							{
								id: "loaded-user",
								role: "user",
								text: target.title ?? "保存済みの会話",
							},
							{
								id: "loaded-agent",
								role: "assistant",
								text: "保存された会話を読み込みました。",
							},
						],
					});
				}
				refresh();
				return;
			}
			bridge.postMessage(message);
		},
	};
}

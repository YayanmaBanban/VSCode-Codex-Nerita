// 履歴一覧の固定応答を提供する。作成・削除・分岐の結果は計算しない。
import { sessionRows } from "../fixtures/sessions";
import { createChatStoryBridge } from "./mockBridge";
/** 履歴ペインの表示条件。 */
export type SessionScenario =
	"history" | "empty" | "error" | "unsupported" | "paginated";
/** 読み取り境界の応答だけを返す。 */
export function createSessionBridge(scenario: SessionScenario) {
	const bridge = createChatStoryBridge();
	const cwd = "workspace/nerita/とても長いフォルダ名のプロジェクト";
	const sessions = scenario === "empty" ? [] : sessionRows();
	const capabilities = {
		list: scenario !== "unsupported",
		load: true,
		fork: true,
		delete: true,
		archive: true,
		rename: true,
		unarchive: true,
	};

	bridge.patchState({ cwd, sessionCapabilities: capabilities });
	const timers = new Set<ReturnType<typeof setTimeout>>();
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
			bridge.postMessage(message);
			if (message.type !== "session/list") {
				return;
			}
			bridge.patchState({ sessionsLoading: true, sessionsError: null });
			const archived = message.archived ?? false;
			const page =
				scenario === "paginated" && !(message.more === true)
					? sessions.slice(0, 2)
					: sessions;
			timers.add(
				setTimeout(
					() =>
						bridge.patchState({
							sessionsLoading: false,
							sessions: archived
								? sessions.slice(0, 1).map((session) => ({
										...session,
										archived: true,
									}))
								: page,
							sessionsArchived: archived,
							sessionsNextCursor:
								scenario === "paginated" &&
								!(message.more === true)
									? "next"
									: null,
							sessionsError:
								scenario === "error"
									? "セッション一覧を取得できませんでした。再試行してください。"
									: null,
						}),
					700,
				),
			);
		},
	};
}

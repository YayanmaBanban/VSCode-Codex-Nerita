// リモートで取得した履歴を共通パネルへ渡し、一覧取得と復元だけを中継する。
import type { UiMessage } from "@nerita/shared/messages";
import type { SessionPanelState } from "../chat/sessions/sessionPanelModel";
import { useSessionPanel } from "../chat/sessions/useSessionPanel.svelte";
import type { useRemoteConnection } from "./useRemoteConnection.svelte";

/** 共通の開閉操作に、リモートのセッション通信を接続する。 */
export function useRemoteSessionPanel(
	connection: ReturnType<typeof useRemoteConnection>,
) {
	let loading = $state(false);
	let restoring = $state(false);
	let error = $state<string | null>(null);
	const sessions = $derived(
		connection.chat?.sessions.map(({ id, title, updatedAt }) => ({
			sessionId: id,
			cwd: "",
			title,
			...(updatedAt === undefined ? {} : { updatedAt }),
		})) ?? [],
	);
	const state = $derived<SessionPanelState>({
		cwd: null,
		connection: connection.chat?.connection ?? "disconnected",
		sessionId: connection.chat?.sessionId ?? null,
		sessionCapabilities: {
			list: true,
			load: connection.chat?.canManageSessions === true,
			fork: false,
			delete: false,
		},
		sessionPending: restoring,
		configPending: !connection.canOperate,
		attachmentPending: false,
		run: connection.chat?.run ?? "idle",
		asyncTasks: [],
		error: null,
		sessions,
		sessionsLoading: loading,
		sessionsError: error,
		sessionsArchived: false,
		sessionsNextCursor: null,
	});

	/** リモートで提供するセッション操作を対応するリクエストへ変換する。 */
	async function send(message: UiMessage) {
		const chat = connection.chat;
		const supported =
			message.type === "session/list" || message.type === "session/load";
		if (chat === undefined || !connection.canOperate || !supported) {
			return;
		}
		error = null;
		loading = message.type === "session/list";
		restoring = message.type === "session/load";
		try {
			const ok =
				message.type === "session/list"
					? await connection.manageSession(chat, "session.list")
					: await connection.manageSession(
							chat,
							"session.new",
							message.sessionId,
						);
			if (ok === false && connection.feedback !== "") {
				error = connection.feedback;
			}
		} finally {
			loading = false;
			restoring = false;
		}
	}

	/** 共通 UI のイベントをリモート操作へ渡す。 */
	function dispatch(message: UiMessage) {
		void send(message);
	}
	const panel = useSessionPanel(dispatch);
	// SSE の認証失効でも履歴を閉じるため、接続状態を監視する。
	$effect(() => {
		if (connection.access !== "chat" && panel.open) {
			void panel.close();
		}
	});
	return {
		panel,
		get state() {
			return state;
		},
		send: dispatch,
	};
}

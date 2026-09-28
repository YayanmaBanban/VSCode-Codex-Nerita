// 固定の認証応答を注入し、本番の接続処理はブラウザで起動しない。
import { codexConnectionText } from "../../../shared/codexConnection";
import { createChatStoryBridge } from "./mockBridge";
/** 認証デモに必要なイベントを配信する。 */
export function createCodexLifecycleBridge(
	mode: "reconnect" | "success" | "failure",
) {
	const bridge = createChatStoryBridge(
		mode === "reconnect" ? "error" : "auth",
	);
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
			if (
				message.type !== "auth/start" &&
				message.type !== "connection/retry"
			) {
				return;
			}
			bridge.patchState({
				connection:
					mode === "reconnect" ? "connecting" : "authenticating",
				sessionPending: true,
				error: null,
			});
			timers.add(
				setTimeout(() => {
					if (mode === "failure") {
						bridge.patchState({
							connection: "auth-required",
							sessionPending: false,
							error: codexConnectionText.authenticationFailed,
						});
					} else {
						bridge.patchState({
							connection: "ready",
							sessionPending: false,
							error: null,
							sessionId: "preview-thread",
						});
					}
				}, 400),
			);
		},
	};
}

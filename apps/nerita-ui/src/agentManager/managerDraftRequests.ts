// 設定保存の応答と、退避専用の応答を別々の要求番号で照合する。
import type {
	ManagerBridge,
	ManagerReply,
	ManagerState,
} from "@nerita/shared/agentManager/messages";
import type { ManagerDraft } from "@nerita/shared/agentManager/draft";

/** 下書き保存の応答を待つ要求を管理し、画面の破棄時には待機中の要求を失敗として扱う。 */
export function createManagerDraftRequests(
	bridge: ManagerBridge,
	state: () => ManagerState | undefined,
) {
	let sequence = 0;
	const pending = new Map<
		number,
		{ resolve: () => void; reject: (error: Error) => void }
	>();
	return {
		/** 下書きへの応答を消費し、通常の保存状態には影響させない。 */
		receive(message: ManagerReply) {
			if (message.type !== "reply") {
				return false;
			}
			const request = pending.get(message.id);
			if (!request) {
				return false;
			}
			pending.delete(message.id);
			if (message.error === null) {
				request.resolve();
			} else {
				request.reject(new Error(message.error));
			}
			return true;
		},
		/** 退避先のワークスペースを固定して、完了応答まで待つ。 */
		write(this: void, draft: ManagerDraft | null): Promise<void> {
			const workspace = state()?.workspace;
			if (workspace === undefined) {
				return Promise.reject(new Error("設定を取得できていません。"));
			}
			const id = --sequence;
			return new Promise((resolve, reject) => {
				pending.set(id, { resolve, reject });
				bridge.postMessage({ type: "draft", id, workspace, draft });
			});
		},
		/** Webview の終了後まで Promise を保持しない。 */
		dispose(this: void) {
			for (const request of pending.values()) {
				request.reject(new Error("管理画面を閉じました。"));
			}
			pending.clear();
		},
	};
}

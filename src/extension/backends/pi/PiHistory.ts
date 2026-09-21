// SDKの保存領域に属する一覧だけを表示し、待機中の切替・古い取得結果を防ぐ。
import { PiRun } from "./PiRun";

/** 一覧取得と会話の切替を、送信と同じ接続世代で管理する。 */
export abstract class PiHistory extends PiRun {
	private listing = 0;

	/** Piはアーカイブとページ分割を公開せず、現在の保存先を一覧する。 */
	protected async refreshSessions(): Promise<void> {
		const runtime = this.runtime;
		if (!runtime?.history || this.state.sessionPending) {
			throw new Error("Piの履歴を取得できません。");
		}
		const epoch = this.epoch;
		const listing = ++this.listing;
		this.patch({ sessionsLoading: true, sessionsError: null });
		const current = () =>
			this.epoch === epoch &&
			this.listing === listing &&
			this.runtime === runtime;
		try {
			const sessions = await runtime.history.list(this.connectionSignal);
			if (current()) {
				this.patch({
					sessions,
					sessionsNextCursor: null,
					sessionsArchived: false,
				});
			}
		} catch (error) {
			if (current()) {
				this.patch({
					sessionsError:
						error instanceof Error
							? error.message
							: "Piの履歴を取得できませんでした。",
				});
			}
		} finally {
			if (current()) {
				this.patch({ sessionsLoading: false });
			}
		}
	}

	/** 選択済みのIDからHost内で復元先を決め、ファイルパスをUIへ渡さない。 */
	protected async loadSession(id: string): Promise<void> {
		const history = this.runtime?.history;
		if (
			!history ||
			this.busy() ||
			this.state.sessionPending ||
			!this.state.sessions.some((row) => row.sessionId === id)
		) {
			throw new Error(
				"Piの処理が終わってから、一覧にある履歴を選択してください。",
			);
		}
		if (id === this.state.sessionId) {
			return;
		}
		await this.connect(history.target(id));
	}
}

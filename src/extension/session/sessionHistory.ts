// cwd ごとの一覧取得と、履歴を保全するセッション切り替えを管理する。
import type { SessionNotification } from "@agentclientprotocol/sdk";
import { initialState, type ChatState } from "../../shared/messages";
import { taskActive } from "../../shared/asyncTask";
import type { AcpTransport } from "../acp/transport";
import { SessionLifecycle } from "./sessionLifecycle";
import { initialConfig } from "./configuration";
import { updateState } from "./updates";
import { sameCwd, listProjectSessions } from "./sessionCatalog";
import type { TaskUpdate } from "../acp/airTasks";
import { updateAsyncTasks } from "./asyncTasks";

/** 履歴操作の結果を接続世代に限定し、成功してから表示を切り替える。 */
export class SessionHistory extends SessionLifecycle {
	private listVersion = 0;
	private replay: ChatState | undefined;
	/** 読み込み応答に先行する通知を仮の会話へ集める。 */
	protected override handleUpdate(notification: SessionNotification): void {
		if (this.replay?.sessionId === notification.sessionId) {
			this.replay = {
				...this.replay,
				...updateState(this.replay, notification, true),
				revision: this.replay.revision + 1,
			};
		} else {
			super.handleUpdate(notification);
		}
	}
	/** 読み込み時に再通知されたバックグラウンドタスクも保持する。 */
	protected override handleAsyncTask(update: TaskUpdate): void {
		if (this.replay?.sessionId === update.sessionId) {
			this.replay = {
				...this.replay,
				...updateAsyncTasks(this.replay, update),
			};
		} else {
			super.handleAsyncTask(update);
		}
	}
	/** 再接続時には途中の取得結果を無効にする。 */
	protected override disconnect(): void {
		this.listVersion++;
		this.replay = undefined;
		super.disconnect();
	}
	/** 新規会話の作成後に一覧を更新する。 */
	protected override async openSession(
		transport: AcpTransport,
		epoch: number,
	): Promise<void> {
		await super.openSession(transport, epoch);
		if (epoch === this.epoch) {
			await this.refreshSessions();
		}
	}
	/** ページ取得の状態を通知し、古い結果で新しい一覧を上書きしない。 */
	protected async refreshSessions(clearError = true): Promise<void> {
		const transport = this.transport;
		if (!transport || this.state.connection !== "ready") {
			return;
		}
		if (!this.state.sessionCapabilities.list) {
			this.patch({
				sessionsError: "この接続先はセッション一覧に対応していません。",
			});
			return;
		}
		const epoch = this.epoch;
		const version = ++this.listVersion;
		const current = () =>
			epoch === this.epoch && version === this.listVersion;
		this.patch({
			sessionsLoading: true,
			...(clearError ? { sessionsError: null } : {}),
		});
		try {
			const sessions = await listProjectSessions(transport, current);
			if (sessions && current()) {
				this.patch({ sessions });
			}
		} catch {
			if (current()) {
				this.patch({
					sessionsError:
						"セッション一覧を取得できませんでした。再試行してください。",
				});
			}
		} finally {
			if (current()) {
				this.patch({ sessionsLoading: false });
			}
		}
	}
	/** 一覧内の同じ cwd の会話だけを読み込み・フォーク・アーカイブする。 */
	protected async manageSession(
		action: "load" | "fork" | "delete",
		sessionId: string,
	): Promise<void> {
		const transport = this.transport;
		if (
			!transport ||
			this.state.connection !== "ready" ||
			this.busy() ||
			this.state.sessionPending ||
			this.state.configPending ||
			this.state.attachmentPending ||
			this.state.asyncTasks.some(taskActive) ||
			!this.state.sessionCapabilities[action] ||
			(action === "fork" && !this.state.sessionCapabilities.load) ||
			!this.state.sessions.some(
				(item) =>
					item.sessionId === sessionId &&
					sameCwd(item.cwd, transport.cwd),
			)
		) {
			throw new Error("Session unavailable");
		}
		if (action === "load" && sessionId === this.state.sessionId) {
			return;
		}
		const epoch = this.epoch;
		this.patch({ sessionPending: true, sessionsError: null });
		try {
			if (action === "delete") {
				await transport.deleteSession(sessionId);
				if (epoch !== this.epoch) {
					return;
				}
				this.listVersion++;
				this.patch({
					sessions: this.state.sessions.filter(
						(item) => item.sessionId !== sessionId,
					),
				});
				if (sessionId === this.state.sessionId) {
					this.patch({
						sessionId: null,
						runId: null,
						run: "idle",
						messages: [],
						tools: [],
						asyncTasks: [],
						permissions: [],
						configOptions: [],
						attachments: [],
						usage: null,
					});
				}
			} else {
				const target =
					action === "fork"
						? (await transport.forkSession(sessionId)).sessionId
						: sessionId;
				if (epoch !== this.epoch) {
					return;
				}
				this.replay = {
					...initialState(),
					sessionId: target,
					runId: `history:${target}`,
					run: "running",
					revision: this.state.revision,
				};
				const result = await transport.loadSession(target);
				if (epoch !== this.epoch || !this.replay) {
					return;
				}
				this.patch({
					sessionId: target,
					runId: null,
					run: "idle",
					messages: this.replay.messages,
					tools: this.replay.tools,
					asyncTasks: this.replay.asyncTasks,
					permissions: [],
					attachments: [],
					usage: this.replay.usage,
					configOptions: initialConfig({
						...result,
						sessionId: target,
					}),
					error: null,
				});
			}
		} catch {
			if (epoch === this.epoch) {
				const label = {
					load: "読み込み",
					fork: "フォーク",
					delete: "アーカイブ",
				}[action];
				this.patch({
					sessionsError: `セッションの${label}に失敗しました。再試行してください。`,
				});
			}
		} finally {
			if (epoch === this.epoch) {
				this.replay = undefined;
				this.patch({ sessionPending: false });
				await this.refreshSessions(false);
			}
		}
	}
}

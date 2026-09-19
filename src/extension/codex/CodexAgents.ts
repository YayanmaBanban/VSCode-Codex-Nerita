// 親の実行セッションを変更せず、子Threadの通知・メタデータ・閲覧を提供する。
import type { UiMessage } from "../../shared/messages";
import { CodexRequests } from "./CodexRequests";
import { AgentRegistry, agentMetadata } from "./agents/AgentRegistry";
import { threadAgentStatus, withThreadStatus } from "./items/agentItems";
import { hydrateHistory, replayHistory } from "./restoreHistory";
import type { AppServerNotification } from "./protocol/rpcMessage";
import { isRecord } from "../../shared/validation";

/** Agent用の読み取りを接続世代と親セッションに限定する。 */
export abstract class CodexAgents extends CodexRequests {
	private readonly agentRegistry = new AgentRegistry();
	private metadataRequests = new Map<string, Promise<void>>();
	/** 子の通知は親ターンのthreadIdフィルターより前に処理する。 */
	protected override notification(message: AppServerNotification): void {
		super.notification(message);
		// 親の項目は開始応答待ちも含め、CodexRunが本文と同じ受信順で再生する。
		if (
			isRecord(message.params) &&
			message.params.threadId === this.state.sessionId &&
			(message.method === "turn/completed" ||
				(this.active &&
					["item/started", "item/completed"].includes(
						message.method,
					)))
		) {
			return;
		}
		this.agentNotification(message);
	}
	/** 最終一覧の項目も通常通知と同じ重複排除へ通す。 */
	protected agentNotification(message: AppServerNotification): void {
		this.agentRegistry.reset(`${this.epoch}:${this.state.sessionId}`);
		const patch = this.agentRegistry.notification(this.state, message);
		if (patch.agents) {
			this.patch(patch);
		}
		this.synchronizeAgents();
	}
	/** 開始直後と履歴復元後に名前を補完し、遅いreadで新しい状態を上書きしない。 */
	protected synchronizeAgents(): void {
		const client = this.client;
		const sessionId = this.state.sessionId;
		const epoch = this.epoch;
		if (!client || !sessionId) {
			return;
		}
		for (const agent of this.state.agents) {
			const key = `${epoch}:${sessionId}:${agent.threadId}`;
			if (this.metadataRequests.has(key)) {
				continue;
			}
			const operation = client
				.readThread(agent.threadId)
				.then(({ thread }) => {
					if (
						this.epoch !== epoch ||
						this.state.sessionId !== sessionId ||
						thread.id !== agent.threadId
					) {
						return;
					}
					this.patch({
						agents: this.state.agents.map((current) => {
							if (current.threadId !== agent.threadId) {
								return current;
							}
							const enriched = {
								...current,
								...agentMetadata(thread),
							};
							const status = threadAgentStatus(thread.status);
							return current === agent && status
								? withThreadStatus(enriched, status)
								: enriched;
						}),
					});
				})
				.catch(() => {
					/* 未保存のThreadはパス名で表示し、閲覧操作で再取得する。 */
				});
			this.metadataRequests.set(key, operation);
		}
		for (const key of this.metadataRequests.keys()) {
			if (!key.startsWith(`${epoch}:${sessionId}:`)) {
				this.metadataRequests.delete(key);
			}
		}
	}
	/** 許可済みの子Threadだけを読み、resumeやactive sessionの切り替えを行わない。 */
	protected async readAgent(
		message: Extract<UiMessage, { type: "agent/read" }>,
	): Promise<void> {
		const client = this.client;
		const { sessionId, cwd } = this.state;
		const epoch = this.epoch;
		const known = this.state.agents.find(
			(agent) => agent.threadId === message.threadId,
		);
		if (
			!client ||
			!cwd ||
			!known ||
			sessionId !== message.sessionId ||
			this.state.connection !== "ready"
		) {
			throw new Error("Unknown agent");
		}
		const current = () =>
			epoch === this.epoch && sessionId === this.state.sessionId;
		const { thread } = await client.readThread(message.threadId, true);
		if (!current()) {
			return;
		}
		if (
			thread.id !== message.threadId ||
			(thread.parentThreadId &&
				thread.parentThreadId !== known.parentThreadId)
		) {
			throw new Error("Unexpected agent thread");
		}
		// 子が専用worktreeを使う場合もあるため、cwdではなく既知のIDと親子関係で限定する。
		const turns = await hydrateHistory(client, thread, current, true);
		if (!current()) {
			return;
		}
		const view = replayHistory(turns, thread.id);
		const agents = new Map(
			this.state.agents.map((agent) => [agent.threadId, agent]),
		);
		// 読み取り中の通知を優先し、履歴から見つかった孫Threadだけを追加する。
		for (const agent of view.agents) {
			if (!agents.has(agent.threadId)) {
				agents.set(agent.threadId, agent);
			}
		}
		const latest = agents.get(known.threadId)!;
		const status = threadAgentStatus(thread.status);
		const enriched = {
			...agents.get(known.threadId)!,
			...agentMetadata(thread),
		};
		agents.set(
			known.threadId,
			latest === known && status
				? withThreadStatus(enriched, status)
				: enriched,
		);
		this.patch({ agents: [...agents.values()] });
		this.synchronizeAgents();
		this.emit({
			type: "agent/view",
			requestId: message.requestId,
			view: {
				...view,
				agents: [...agents.values()].filter(
					(agent) => agent.parentThreadId === thread.id,
				),
				threadId: thread.id,
				parentThreadId: thread.parentThreadId ?? known.parentThreadId,
			},
		});
	}
}

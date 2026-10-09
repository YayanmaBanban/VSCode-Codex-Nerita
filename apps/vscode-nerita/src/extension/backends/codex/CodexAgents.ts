// 親の実行セッションを変更せず、子スレッドの通知・メタデータ・閲覧を提供する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import type { HostMessage, UiMessage } from "@nerita/shared/messages";
import type { ChatState } from "@nerita/shared/chatState";
import type { ToolOutputStore } from "../../session/ToolOutputStore";
import { AgentRegistry, agentMetadata } from "./agents/AgentRegistry";
import { threadAgentStatus, withThreadStatus } from "./items/agentItems";
import { restoreDisplayHistory } from "./history/restoreHistory";
import type { AppServerNotification } from "./protocol/rpcMessage";
import { agentSubtree, type SubAgentSummary } from "@nerita/shared/subAgents";
import { setTimeout } from "node:timers/promises";
import { type HistoryThread } from "./protocol/history";
import type { CodexConnection } from "./runtime/connection";

/** 通知後の変更を参照の同一性で確認し、閲覧出力の管理はセッションへ委ねる。 */
type AgentSession = {
	snapshot: () => Readonly<ChatState>;
	connection: () => CodexConnection | undefined;
	epoch: () => number;
	patch: (change: Partial<ChatState>) => void;
	publishView: (
		message: Extract<HostMessage, { type: "agent/view" }>,
		outputs: ToolOutputStore,
	) => void;
	publishStopped: (
		message: Extract<HostMessage, { type: "agent/stopped" }>,
	) => void;
};

/** 子の通知・メタデータ・閲覧を管理し、親ターンの通知の振り分けはコントローラーへ委ねる。 */
export class CodexAgents {
	private readonly agentRegistry = new AgentRegistry();
	private metadataRequests = new Map<string, Promise<void>>();
	constructor(private readonly session: AgentSession) {}

	/** 親の実行状態は変更せず、既知の対象と子孫の稼働ターンだけを中断する。 */
	async stop(
		message: Extract<UiMessage, { type: "agent/stop" }>,
	): Promise<void> {
		const client = this.session.connection();
		const epoch = this.session.epoch();
		const current = () => {
			const state = this.session.snapshot();
			return (
				this.session.epoch() === epoch &&
				state.sessionId === message.sessionId &&
				state.connection === "ready" &&
				!state.sessionPending
			);
		};
		if (
			!client ||
			!current() ||
			!this.session
				.snapshot()
				.agents.some((agent) => agent.threadId === message.threadId)
		) {
			throw new Error("この会話に停止対象のエージェントがありません。");
		}
		const stopped = new Set<string>();
		const deadline = Date.now() + 10000;
		// 対象自身を先に中断し、処理中に通知された新しい子孫も次の繰り返しで停止対象に加える。
		while (current()) {
			const targets = agentSubtree(
				this.session.snapshot().agents,
				message.threadId,
			).filter((agent) => !stopped.has(agent.threadId));
			if (targets.length === 0) {
				this.session.publishStopped({
					type: "agent/stopped",
					requestId: message.requestId,
					threadId: message.threadId,
				});
				return;
			}
			for (const target of targets) {
				await interruptAgentThread(client, target, current, deadline);
				stopped.add(target.threadId);
			}
		}
		throw new Error("会話が切り替わったため、停止を中止しました。");
	}

	/** 最終一覧の項目も通常通知と同じ重複排除へ通す。 */
	notification(message: AppServerNotification): void {
		const state = this.session.snapshot();
		this.agentRegistry.reset(`${this.session.epoch()}:${state.sessionId}`);
		const patch = this.agentRegistry.notification(state, message);
		if (patch.agents) {
			this.session.patch(patch);
		}
		this.synchronize();
	}
	/** 開始直後と履歴復元後に名前を補完し、遅い `read` で新しい状態を上書きしない。 */
	synchronize(): void {
		const state = this.session.snapshot();
		const client = this.session.connection();
		const sessionId = state.sessionId;
		const epoch = this.session.epoch();
		if (!client || !isNonEmptyString(sessionId)) {
			return;
		}
		for (const agent of state.agents) {
			const key = `${epoch}:${sessionId}:${agent.threadId}`;
			if (this.metadataRequests.has(key)) {
				continue;
			}
			const operation = client
				.readThread(agent.threadId)
				.then(({ thread }) => {
					const latest = this.session.snapshot();
					if (
						this.session.epoch() !== epoch ||
						latest.sessionId !== sessionId ||
						thread.id !== agent.threadId
					) {
						return;
					}
					this.session.patch({
						agents: latest.agents.map((current) => {
							if (current.threadId !== agent.threadId) {
								return current;
							}
							const enriched = {
								...current,
								...agentMetadata(thread),
							};
							const status = threadAgentStatus(thread.status);
							return current === agent && status !== undefined
								? withThreadStatus(enriched, status)
								: enriched;
						}),
					});
				})
				.catch(() => {
					/* 未保存のスレッドはパス名で表示し、閲覧操作で再取得する。 */
				});
			this.metadataRequests.set(key, operation);
		}
		for (const key of this.metadataRequests.keys()) {
			if (!key.startsWith(`${epoch}:${sessionId}:`)) {
				this.metadataRequests.delete(key);
			}
		}
	}
	/** 既知の子スレッドだけを読み、会話の再開や現在のセッションの切り替えは行わない。 */
	async read(
		message: Extract<UiMessage, { type: "agent/read" }>,
	): Promise<void> {
		const state = this.session.snapshot();
		const client = this.session.connection();
		const { sessionId, cwd } = state;
		const epoch = this.session.epoch();
		const known = state.agents.find(
			(agent) => agent.threadId === message.threadId,
		);
		if (
			!client ||
			!isNonEmptyString(cwd) ||
			!known ||
			sessionId !== message.sessionId ||
			state.connection !== "ready"
		) {
			throw new Error("Unknown agent");
		}
		const current = () =>
			epoch === this.session.epoch() &&
			sessionId === this.session.snapshot().sessionId;
		const { thread } = await readAgentThread(
			client,
			message.threadId,
			current,
		);
		if (!current()) {
			return;
		}
		if (
			!matchesAgentThread(thread, message.threadId, known.parentThreadId)
		) {
			throw new Error("Unexpected agent thread");
		}
		// 子が専用 `worktree` を使う場合もあるため、`cwd` ではなく既知の ID と親子関係で限定する。
		const restored = await restoreDisplayHistory(
			client,
			thread,
			current,
			true,
		);
		if (!current()) {
			restored.outputs.dispose();
			return;
		}

		this.publishAgentView(restored, thread, known, message);
	}

	/** 読み取り中の通知を優先しながらエージェント履歴を公開する。 */
	private publishAgentView(
		restored: Awaited<ReturnType<typeof restoreDisplayHistory>>,
		thread: HistoryThread,
		known: SubAgentSummary,
		message: {
			type: "agent/read";
			requestId: string;
			sessionId: string;
			threadId: string;
		},
	) {
		const { state: view, outputs } = restored;

		const agents = new Map(
			this.session
				.snapshot()
				.agents.map((agent) => [agent.threadId, agent]),
		);

		// 読み取り中の通知を優先し、履歴から見つかった孫スレッドだけを追加する。
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
			latest === known && status !== undefined
				? withThreadStatus(enriched, status)
				: enriched,
		);

		this.session.patch({ agents: [...agents.values()] });

		this.synchronize();

		this.session.publishView(
			{
				type: "agent/view",
				requestId: message.requestId,
				view: {
					...view,
					agents: [...agents.values()].filter(
						(agent) => agent.parentThreadId === thread.id,
					),
					threadId: thread.id,
					parentThreadId:
						thread.parentThreadId ?? known.parentThreadId,
				},
			},
			outputs,
		);
	}
}

/** 初期化と停止が競合した場合はターンの公開を待ち、古い接続や別の親のターンは操作しない。 */
async function interruptAgentThread(
	client: CodexConnection,
	agent: SubAgentSummary,
	current: () => boolean,
	deadline: number,
): Promise<void> {
	while (current() && Date.now() < deadline) {
		const { thread } = await readAgentThread(
			client,
			agent.threadId,
			current,
		);
		if (
			!current() ||
			!matchesAgentThread(thread, agent.threadId, agent.parentThreadId)
		) {
			throw new Error("停止対象の会話を確認できませんでした。");
		}
		const turns =
			thread.historyMode === "paginated"
				? (
						await client.listTurns(
							agent.threadId,
							undefined,
							"summary",
							"desc",
						)
					).data
				: thread.turns;
		if (!current()) {
			throw new Error("会話が切り替わったため、停止を中止しました。");
		}
		const turn = turns.find((item) => item.status === "inProgress");
		if (turn) {
			await client.interruptTurn(agent.threadId, turn.id);
			return;
		}
		if (!awaitingAgentTurn(thread, agent)) {
			return;
		}
		await setTimeout(100);
	}
	throw new Error(
		"停止対象の実行を確認できませんでした。表示を更新して再試行してください。",
	);
}

/** 初期化中や活動中はターンをまだ取得できない場合があるため、終了済みとは区別する。 */
function awaitingAgentTurn(
	thread: HistoryThread,
	agent: SubAgentSummary,
): boolean {
	return (
		thread.active ||
		thread.status === "notLoaded" ||
		agent.status === "pendingInit"
	);
}

/** ページ形式では本文の一括要求を避け、旧形式だけ本文付きで取得し直す。 */
async function readAgentThread(
	client: CodexConnection,
	threadId: string,
	current: () => boolean,
) {
	const result = await client.readThread(threadId);
	if (
		current() &&
		result.thread.id === threadId &&
		result.thread.historyMode === "legacy"
	) {
		return client.readThread(threadId, true);
	}
	return result;
}

/** 子スレッドの識別子と既知の親子関係を照合する。 */
function matchesAgentThread(
	thread: { id: string; parentThreadId?: string },
	threadId: string,
	parentThreadId: string,
): boolean {
	return (
		thread.id === threadId &&
		(!isNonEmptyString(thread.parentThreadId) ||
			thread.parentThreadId === parentThreadId)
	);
}

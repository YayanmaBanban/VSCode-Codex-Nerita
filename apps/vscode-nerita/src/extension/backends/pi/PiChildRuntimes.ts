// 子 Runtime の起動条件を親から固定し、Stop・切断時には子孫も回収する。
import type {
	AgentAccessPolicy,
	AgentRole,
} from "../../security/AgentAccessPolicy";
import { childSettings } from "./PiChildSettings";
import { freezeToolCall } from "../../security/ApprovedToolCall";
import type { PiRuntimeOptions, PiRuntimeSession } from "./PiRuntime";
import type { PiForkMessage } from "./PiForkContext";
import type { PiJobs } from "./PiJobs";
import type { PiDefaults } from "@nerita/shared/agentManager/config";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { isRecord } from "@nerita/shared/validation";
import {
	BackendShutdown,
	BackendShutdownError,
} from "../../session/BackendShutdown";

/** 子は許可範囲内の作業場所と権限を指定できる。実行基盤・承認先・親の権限設定は差し替えられない。 */
export type PiChildOptions = {
	cwd?: string;
	role: AgentRole;
	signal?: AbortSignal;
	allowedTools?: string[];
	systemPrompt?: string;
	systemPromptMode?: "append" | "replace";
	preferredModel?: PiRuntimeOptions["preferredModel"];
	approvalContext?: { agent: string; task: string };
	initialMessages?: PiForkMessage[];
	jobId?: string;
	workflowApproval?: { id: string; agent: string; task: string };
};

/** 起動中の子も追跡し、親終了と SDK 初期化完了の競合を処理する。 */
type Child = {
	abort: AbortController;
	opening: Promise<PiRuntimeSession>;
	session?: PiRuntimeSession;
	closing?: Promise<void>;
	closeSession?: () => Promise<void>;
	detachAbort?: () => void;
};

/** 同じ会話の起動回数だけを復元し、fork 先には元の会話の消費数を持ち込まない。 */
function sessionSpawns(manager: SessionManager | undefined) {
	let count = 0;
	for (const entry of manager?.getBranch() ?? []) {
		const unrelated =
			entry.type !== "custom" ||
			entry.customType !== "nerita.subagent-spawns.v1";
		if (unrelated) {
			continue;
		}
		const data = isRecord(entry.data) ? entry.data : {};
		if (data.sessionId !== manager!.getSessionId()) {
			continue;
		}
		const value = data.count;
		if (validSpawnCount(value)) {
			count = Math.max(count, value);
		}
	}
	return count;
}

/** 復元値は非負の安全な整数だけを受け付ける。 */
function validSpawnCount(value: unknown): value is number {
	return (
		typeof value === "number" && Number.isSafeInteger(value) && value >= 0
	);
}

/** 外部 Pi 拡張を使わず、Host が所有する実効 `policy` で子を起動する。 */
export class PiChildRuntimes {
	private readonly children = new Set<Child>();
	private readonly parent: PiRuntimeOptions;
	private readonly policy: AgentAccessPolicy;
	private disposed = false;
	private stoppingNow = false;
	private stopping: Promise<void> | undefined;
	private readonly shutdown = new BackendShutdown();
	private spawned: number;

	/** 親のツール上限とルートをコピーして固定し、呼び出し側の変更で子の権限を広げない。 */
	constructor(
		parent: PiRuntimeOptions,
		policy: AgentAccessPolicy,
		private readonly lifetime: AbortSignal,
		private readonly create: (
			options: PiRuntimeOptions,
		) => Promise<PiRuntimeSession>,
		private readonly jobs?: PiJobs,
		private readonly readSettings?: () => Promise<PiDefaults>,
		private readonly manager?: SessionManager,
	) {
		this.parent = {
			...parent,
			workspaceRoots: [...(parent.workspaceRoots ?? [parent.cwd])],
			...(parent.allowedTools
				? { allowedTools: [...parent.allowedTools] }
				: {}),
		};
		this.policy = freezeToolCall(policy);
		this.spawned = sessionSpawns(manager);
	}

	/** 親と role の両方で許可される権限だけを残す。会話の複製と外部拡張の継承は分ける。 */
	async open(options: PiChildOptions): Promise<PiRuntimeSession> {
		await this.shutdown.wait();
		const settings = await this.readSettings?.();
		this.lifetime.throwIfAborted();
		if (this.disposed || this.stoppingNow) {
			throw new Error("終了中の親Runtimeから子を起動できません。");
		}
		const abort = new AbortController();
		const signal = AbortSignal.any([
			this.lifetime,
			abort.signal,
			...(options.signal ? [options.signal] : []),
		]);
		signal.throwIfAborted();
		this.parent.trustStore?.audit(
			"subagent-root",
			options.cwd ?? this.parent.cwd,
		);
		const childOptions: PiRuntimeOptions = {
			...this.parent,
			cwd: options.cwd ?? this.parent.cwd,
			parentPolicy: this.policy,
			role: freezeToolCall(options.role),
			signal,
			// 子の内部履歴をワークスペースや親の履歴選択へ混在させない。
			storage: "global",
			ephemeral: true,
			trustedExtensionPaths: [],
			...childSettings(this.parent, options, this.jobs),
			maximumThinking: this.maximumThinking(settings),
		};
		delete childOptions.resume;
		delete childOptions.getStorage;
		delete childOptions.saveModel;
		this.reserveSpawn(settings);
		const child: Child = {
			abort,
			opening: this.create(childOptions),
		};
		this.children.add(child);
		/** 接続 `signal` の取消しでも、モデル応答を待たず子の SDK を停止する。 */
		const cancel = () => {
			void this.close(child).catch(() => undefined);
		};
		signal.addEventListener("abort", cancel, { once: true });
		child.detachAbort = () => signal.removeEventListener("abort", cancel);
		try {
			const session = await child.opening;
			child.session = session;
			child.closeSession = session.close.bind(session);
			session.close = () => this.close(child);
			let disposed = false;
			/** 個別終了でも起動時の signal を取り消し、終了処理が完了したら親の追跡から外す。 */
			session.dispose = () => {
				if (disposed) {
					return;
				}
				disposed = true;
				// 非同期回収が終わるまでは親の追跡に残す。
				void this.close(child).catch(() => undefined);
			};
			if (signal.aborted) {
				await this.close(child);
				signal.throwIfAborted();
			}
			return session;
		} catch (error) {
			child.detachAbort();
			this.children.delete(child);
			throw error;
		}
	}

	/** 親の上限を継承し、最新の保存設定がある場合はそちらを適用する。 */
	private maximumThinking(settings: PiDefaults | undefined) {
		return settings?.maxThinking ?? this.parent.maximumThinking;
	}

	/** 並列起動も受付時に枠を消費する。失敗した起動を再試行して上限を迂回させない。 */
	private reserveSpawn(settings: PiDefaults | undefined) {
		const maximum = settings?.maxSubagentSpawnsPerSession;
		if (maximum !== undefined && this.spawned >= maximum) {
			throw new Error(
				"このセッションのエージェント起動上限に達しました。",
			);
		}
		this.spawned++;
		this.manager?.appendCustomEntry("nerita.subagent-spawns.v1", {
			sessionId: this.manager.getSessionId(),
			count: this.spawned,
		});
	}

	/** 起動待ち・承認待ち・実行中の子をすべて止め、終了まで待つ。 */
	stop(): Promise<void> {
		if (!this.stopping) {
			// 中止イベントのリスナーが同期的に子を起動し直す場合も、先に受付を閉じる。
			this.stoppingNow = true;
			this.stopping = Promise.allSettled(
				[...this.children].map((child) => this.close(child)),
			)
				.then(() => this.shutdown.wait())
				.finally(() => {
					this.stoppingNow = false;
					this.stopping = undefined;
				});
		}
		return this.stopping;
	}

	/** 起動完了と Stop が競合しても、子の abort と close は一度だけ呼び出す。 */
	private close(child: Child): Promise<void> {
		/** 起動待ちを回収し、中止の失敗後も終了確認を行う。失敗を保持して子の登録と取消し購読を外す。 */
		const closeChildRuntime = async () => {
			try {
				const session =
					child.session ??
					(await child.opening.catch((error: unknown) => {
						if (error instanceof BackendShutdownError) {
							throw error;
						}
						return undefined;
					}));
				if (session) {
					// 実行の中止が失敗しても、close による終了確認を必ず行う。
					await session.abort().catch(() => {});
					await (
						child.closeSession ?? session.close.bind(session)
					)().catch((error: unknown) => {
						throw new BackendShutdownError(error);
					});
				}
			} catch (error) {
				this.shutdown.recordFailure(error);
				throw error;
			} finally {
				child.detachAbort?.();
				this.children.delete(child);
			}
		};
		child.closing ??= Promise.resolve().then(closeChildRuntime);
		child.abort.abort();
		return child.closing;
	}

	/** 同期 `dispose` でも起動 `signal` は即座に失効し、終了処理は追跡して回収する。 */
	dispose(): void {
		this.disposed = true;
		void this.stop().catch(() => {});
	}
}

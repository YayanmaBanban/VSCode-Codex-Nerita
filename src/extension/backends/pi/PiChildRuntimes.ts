// 子 Runtime の起動条件を親から固定し、Stop・切断時には子孫も回収する。
import type {
	AgentAccessPolicy,
	AgentRole,
} from "../../security/AgentAccessPolicy";
import { freezeToolCall } from "../../security/ApprovedToolCall";
import type { PiRuntimeOptions, PiRuntimeSession } from "./PiRuntime";

/** 子は作業場所と `role` を狭められるが、executor・承認先・親 `policy` を差し替えられない。 */
export type PiChildOptions = {
	cwd?: string;
	role: AgentRole;
	signal?: AbortSignal;
};

/** 起動中の子も追跡し、親終了と SDK 初期化完了の競合を処理する。 */
type Child = {
	abort: AbortController;
	opening: Promise<PiRuntimeSession>;
	session?: PiRuntimeSession;
	closing?: Promise<void>;
	detachAbort?: () => void;
};

/** 外部 Pi 拡張を使わず、Host が所有する実効 `policy` で子を起動する。 */
export class PiChildRuntimes {
	private readonly children = new Set<Child>();
	private readonly parent: PiRuntimeOptions;
	private readonly policy: AgentAccessPolicy;
	private disposed = false;
	private stoppingNow = false;
	private stopping: Promise<void> | undefined;

	constructor(
		parent: PiRuntimeOptions,
		policy: AgentAccessPolicy,
		private readonly lifetime: AbortSignal,
		private readonly create: (
			options: PiRuntimeOptions,
		) => Promise<PiRuntimeSession>,
	) {
		this.parent = {
			...parent,
			workspaceRoots: [...(parent.workspaceRoots ?? [parent.cwd])],
		};
		this.policy = freezeToolCall(policy);
	}

	/** 親の実効上限と `role` を Runtime 側で交差し、履歴や外部拡張を引き継がない。 */
	async open(options: PiChildOptions): Promise<PiRuntimeSession> {
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
		};
		delete childOptions.resume;
		delete childOptions.getStorage;
		delete childOptions.saveModel;
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
			let disposed = false;
			/** 個別終了でも親の追跡から外し、起動 `signal` を失効させる。 */
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
			child.detachAbort?.();
			this.children.delete(child);
			throw error;
		}
	}

	/** 起動待ち・承認待ち・実行中の子をすべて止め、終了まで待つ。 */
	stop(): Promise<void> {
		if (!this.stopping) {
			// 中止イベントのリスナーが同期的に子を起動し直す場合も、先に受付を閉じる。
			this.stoppingNow = true;
			this.stopping = Promise.allSettled(
				[...this.children].map((child) => this.close(child)),
			).then(() => {
				this.stoppingNow = false;
				this.stopping = undefined;
			});
		}
		return this.stopping;
	}

	/** 起動完了と `Stop` が競合しても `abort`・`dispose` は一度だけ実施する。 */
	private close(child: Child): Promise<void> {
		child.closing ??= Promise.resolve().then(async () => {
			try {
				const session = child.session ?? (await child.opening);
				try {
					await session.abort();
				} finally {
					await session.close();
				}
			} finally {
				child.detachAbort?.();
				this.children.delete(child);
			}
		});
		child.abort.abort();
		return child.closing;
	}

	/** 同期 `dispose` でも起動 `signal` は即座に失効し、終了処理は追跡して回収する。 */
	dispose(): void {
		this.disposed = true;
		void this.stop();
	}
}

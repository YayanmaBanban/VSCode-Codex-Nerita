// 子Runtimeの起動条件を親から固定し、Stop・切断時には子孫も回収する。
import type { AgentAccessPolicy } from "../../security/AgentAccessPolicy";
import { freezeToolCall } from "../../security/ApprovedToolCall";
import type { PiRuntimeOptions, PiRuntimeSession } from "./PiRuntime";

/** 子は作業場所とroleを狭められるが、executor・承認先・親policyを差し替えられない。 */
export type PiChildOptions = {
	cwd?: string;
	accessPolicy: AgentAccessPolicy;
	signal?: AbortSignal;
};

/** 起動中の子も追跡し、親終了とSDK初期化完了の競合を処理する。 */
type Child = {
	abort: AbortController;
	opening: Promise<PiRuntimeSession>;
	session?: PiRuntimeSession;
	closing?: Promise<void>;
	detachAbort?: () => void;
};

/** 外部Pi拡張を使わず、Hostが所有する実効policyで子を起動する。 */
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

	/** 親の実効上限とroleをRuntime側で交差し、履歴や外部拡張を引き継がない。 */
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
			accessPolicy: freezeToolCall(options.accessPolicy),
			signal,
			// 子の内部履歴をworkspaceや親の履歴選択へ混在させない。
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
		/** 接続signalの取消しでも、モデル応答を待たず子のSDKを停止する。 */
		const cancel = () => {
			void this.close(child).catch(() => undefined);
		};
		signal.addEventListener("abort", cancel, { once: true });
		child.detachAbort = () => signal.removeEventListener("abort", cancel);
		try {
			const session = await child.opening;
			child.session = session;
			const dispose = session.dispose.bind(session);
			let disposed = false;
			/** 個別終了でも親の追跡から外し、起動signalを失効させる。 */
			session.dispose = () => {
				if (disposed) {
					return;
				}
				disposed = true;
				child.detachAbort?.();
				abort.abort();
				this.children.delete(child);
				dispose();
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
			// abort listenerが同期的に子を起動し直す場合も、先に受付を閉じる。
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

	/** 起動完了とStopが競合してもabort・disposeは一度だけ実施する。 */
	private close(child: Child): Promise<void> {
		child.closing ??= Promise.resolve().then(async () => {
			try {
				const session = child.session ?? (await child.opening);
				try {
					await session.abort();
				} finally {
					session.dispose();
				}
			} finally {
				child.detachAbort?.();
				this.children.delete(child);
			}
		});
		child.abort.abort();
		return child.closing;
	}

	/** 同期disposeでも起動signalは即座に失効し、終了処理は追跡して回収する。 */
	dispose(): void {
		this.disposed = true;
		void this.stop();
	}
}

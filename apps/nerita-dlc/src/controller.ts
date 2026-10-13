// 永続化と Runtime を状態機械へ接続し、再送・停止・保存失敗時の二重実行を防ぐ。
import {
	DlcActionSchema,
	type DlcProjection,
} from "@nerita/shared/dlc/contracts";
import {
	type IntentState,
	IntentStateSchema,
	intentProjection,
	recoverIntent,
} from "./state";
import {
	RuntimeResultError,
	type NeritaRuntimePort,
	type ExecutionRequest,
} from "./runtime";
import {
	applyAction,
	beginWork,
	failWork,
	finishWork,
	requestStop,
} from "./transitions";

/** 依頼状態の保存境界。保存時は期待するリビジョンを照合し、競合した更新を上書きしない。 */
export type IntentStore = {
	save(state: IntentState, expectedRevision: number): Promise<void>;
};
/** 実行世代の識別子・中断制御・完了待ちをまとめ、同時実行の管理に使う。 */
type ActiveRun = {
	id: string;
	abort: AbortController;
	operation: Promise<DlcProjection>;
};

/** 作業状態の正当性はここで管理し、Runtime のセッション ID は保存しない。 */
export class DlcController {
	private active: ActiveRun | undefined;
	private pendingSaves = 0;
	private writes: Promise<void> = Promise.resolve();
	private storageFailed = false;
	private listeners = new Set<() => void>();
	/** 復旧済み状態だけを受け取り、初期化は保存結果を確認する open 経由に限定する。 */
	private constructor(
		private state: IntentState,
		private runtime: NeritaRuntimePort,
		private store: IntentStore,
		private newId: () => string,
	) {}

	/** 再起動前の実行を中断状態として保存してから操作を受け付ける。 */
	static async open(
		value: unknown,
		runtime: NeritaRuntimePort,
		store: IntentStore,
		newId: () => string,
	): Promise<DlcController> {
		const previous = IntentStateSchema.parse(value);
		const state = recoverIntent(previous);
		if (state !== previous) {
			await store.save(state, previous.revision);
		}
		return new DlcController(state, runtime, store, newId);
	}

	/** UI には状態の投影だけを返し、実行結果や状態を直接書き換える参照を渡さない。 */
	projection(): DlcProjection {
		return intentProjection(this.state);
	}
	/** 保存済み状態の変更だけを通知し、購読解除は呼出し側が行う。 */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** 操作要求を検証し、エージェントや UI が終端状態を書き込む経路を作らない。 */
	async dispatch(value: unknown): Promise<DlcProjection> {
		const action = DlcActionSchema.parse(value);
		if (action.type === "cancel") {
			return this.cancel();
		}
		if (action.type === "run") {
			return this.run();
		}
		this.assertAvailable();
		await this.update((state) => applyAction(state, action));
		return this.projection();
	}

	/** 実行・保存の重複と保存失敗後の再操作を拒否し、状態を再読込みするまで開始しない。 */
	private assertAvailable() {
		if (this.active || this.pendingSaves > 0 || this.storageFailed) {
			throw new Error(
				"実行または保存中、または保存に失敗しています。状態を再読込みしてください。",
			);
		}
	}
	/** 開始前に実行をロックし、同じ tick の二重要求を拒否する。完了時にだけロックを解除する。 */
	private run(): Promise<DlcProjection> {
		this.assertAvailable();
		const id = this.newId();
		beginWork(this.state, id);
		const abort = new AbortController();
		// Promise の開始前にロックし、同じ tick の二重起動も拒否する。
		const operation = Promise.resolve().then(() =>
			this.execute(id, abort.signal),
		);
		this.active = { id, abort, operation };
		return operation.finally(() => {
			this.active = undefined;
		});
	}
	/** 開始条件の確認を Runtime へ委ね、拒否された実行は作業履歴へ追加しない。 */
	private async execute(
		id: string,
		signal: AbortSignal,
	): Promise<DlcProjection> {
		/** 承認済みの実行世代と中断シグナルを固定して実行処理へ渡す。 */
		const operation = () => this.executeAdmitted(id, signal);
		// 開始条件を満たさない場合は、実行履歴を追加しない。
		return this.runtime.withAdmission
			? this.runtime.withAdmission(operation, signal)
			: operation();
	}
	/** 開始状態を保存してから実行し、結果と失敗を保存する。保存失敗では後続の状態を上書きしない。 */
	private async executeAdmitted(
		id: string,
		signal: AbortSignal,
	): Promise<DlcProjection> {
		await this.update((state) => beginWork(state, id));
		try {
			signal.throwIfAborted();
			const request = this.executionRequest(id);
			const result = await this.runtime.run(request, signal);
			await this.update((state) => finishWork(state, id, result));
		} catch (error) {
			if (this.storageFailed) {
				throw error;
			}
			const detail =
				error instanceof Error
					? error.message
					: "DLC の実行に失敗しました。";
			await this.update((state) =>
				failWork(
					state,
					id,
					signal.aborted ? "cancelled" : "failed",
					detail,
					error instanceof RuntimeResultError
						? error.result
						: undefined,
				),
			);
		}
		return this.projection();
	}
	/** 現在の実行世代に属する作業から要求を作り、毎回新しい会話と継承した権限で実行する。 */
	private executionRequest(attemptId: string): ExecutionRequest {
		const item = this.state.workItems.find(
			(work) => work.attempts.at(-1)?.id === attemptId,
		);
		if (!item) {
			throw new Error("実行対象がありません。");
		}
		return {
			intentId: this.state.intentId,
			request: this.state.intent.request,
			workItemId: item.id,
			attemptId,
			title: item.title,
			instructions: item.instructions,
			paths: [...item.paths],
			continuity: "fresh",
			policy: "workspace-inherit",
		};
	}
	/** 取消しを先に通知し、停止状態の保存が失敗しても Runtime の停止を試みる。 */
	private async cancel(): Promise<DlcProjection> {
		const active = this.active;
		if (!active) {
			return this.projection();
		}
		active.abort.abort();
		try {
			await this.update((state) => requestStop(state, active.id));
		} finally {
			await this.runtime.stop(active.id);
		}
		return active.operation;
	}
	/** 遷移と保存を直列化し、保存に成功した状態だけを公開する。待機件数は失敗時も回収する。 */
	private update(
		transition: (state: IntentState) => IntentState,
	): Promise<void> {
		this.pendingSaves += 1;
		/** 遷移の計算と保存は待機列の順番で行い、保存成功前に公開状態を置き換えない。 */
		const persistTransition = async () => {
			if (this.storageFailed) {
				throw new Error("状態を保存できません。再読込みしてください。");
			}
			const next = transition(this.state);
			if (next === this.state) {
				return;
			}
			try {
				await this.store.save(
					IntentStateSchema.parse(next),
					this.state.revision,
				);
				this.state = next;
				for (const listener of this.listeners) {
					listener();
				}
			} catch (error) {
				this.storageFailed = true;
				throw error;
			}
		};
		const operation = this.writes.then(persistTransition);
		this.writes = operation.catch(() => {});
		return operation.finally(() => {
			this.pendingSaves -= 1;
		});
	}
}

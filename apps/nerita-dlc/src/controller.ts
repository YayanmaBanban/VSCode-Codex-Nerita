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
import { type NeritaRuntimePort, type ExecutionRequest } from "./runtime";
import {
	applyAction,
	beginWork,
	failWork,
	finishWork,
	requestStop,
} from "./transitions";

export type IntentStore = {
	save(state: IntentState, expectedRevision: number): Promise<void>;
};
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

	projection(): DlcProjection {
		return intentProjection(this.state);
	}
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

	private assertAvailable() {
		if (this.active || this.pendingSaves > 0 || this.storageFailed) {
			throw new Error(
				"実行または保存中、または保存に失敗しています。状態を再読込みしてください。",
			);
		}
	}
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
	private async execute(
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
				),
			);
		}
		return this.projection();
	}
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
	private update(
		transition: (state: IntentState) => IntentState,
	): Promise<void> {
		this.pendingSaves += 1;
		const operation = this.writes.then(async () => {
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
		});
		this.writes = operation.catch(() => {});
		return operation.finally(() => {
			this.pendingSaves -= 1;
		});
	}
}

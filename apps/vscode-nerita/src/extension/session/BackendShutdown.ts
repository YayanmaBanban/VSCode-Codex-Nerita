// バックエンドの終了待ちを追跡し、終了を確認できない場合は実行先の予約を解放させない。

/** 起動失敗からの回収も通常の接続失敗と区別し、終了未確認を Runtime まで伝える。 */
export class BackendShutdownError extends Error {
	/** 終了確認の失敗を元の原因とともに保持し、実行先の予約を解放できない状態として伝える。 */
	constructor(cause: unknown) {
		super("バックエンドの終了を確認できません。", { cause });
	}
}

/** 表示上の実行失敗と区別し、再接続時も終了確認の失敗を保持する。 */
export class BackendShutdown {
	private pending = new Set<Promise<void>>();
	private failure: BackendShutdownError | undefined;

	/** 終了処理の失敗を保持し、処理が完了した場合だけ追跡対象から外す。 */
	track(operation: Promise<unknown>): void {
		const settled = operation.then(
			() => {},
			(error: unknown) => {
				this.recordFailure(error);
			},
		);
		this.pending.add(settled);
		void settled.then(() => this.pending.delete(settled));
	}
	/** 終了待ちが終わっても、同期的に判明した回収失敗を保持する。 */
	recordFailure(error: unknown): void {
		this.failure ??=
			error instanceof BackendShutdownError
				? error
				: new BackendShutdownError(error);
	}
	/** 接続を公開する前の失敗では、下位層が明示した終了未確認だけを保持する。 */
	captureOpeningFailure(error: unknown): void {
		if (error instanceof BackendShutdownError) {
			this.recordFailure(error);
		}
	}

	/** 待機中に追加された終了処理も含め、すべての終了確認が成功した場合だけ戻る。 */
	async wait(): Promise<void> {
		while (this.pending.size > 0) {
			await Promise.all(this.pending);
		}
		if (this.failure) {
			throw this.failure;
		}
	}
}

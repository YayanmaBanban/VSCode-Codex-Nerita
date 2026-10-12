// DLC が所有するネイティブ会話を Host の利用者領域に記録し、再起動後の手動利用も拒否する。
import { z } from "zod";

/** 保存完了まで送信しない。一時的な取得競合は再試行し、真正な保存失敗では以後の送信も拒否する。 */
export class DlcSessionOwnership {
	private ids: Set<string>;
	private saving = Promise.resolve();
	/** 所有済み会話の ID を検証して復元し、通常履歴との混在を防ぐ照合に使う。 */
	constructor(
		private store: {
			read(): unknown;
			write(ids: string[]): PromiseLike<void>;
			refresh?: () => Promise<unknown>;
			retryable?: (error: unknown) => boolean;
		},
	) {
		this.ids = new Set(
			z.array(z.string().min(1).max(8192)).parse(store.read() ?? []),
		);
	}
	/** 終了・復元済みも含めた内部会話の所有記録を照合し、通常チャットからの操作を防ぐ。 */
	has(sessionId: string): boolean {
		return this.ids.has(sessionId);
	}
	/** 所有 ID をメモリーへ先に記録して保存を直列化し、再試行可能な競合だけを後続の保存で回復する。 */
	remember(sessionId: string): void {
		if (this.ids.has(sessionId)) {
			return;
		}
		this.ids.add(sessionId);
		this.saving = this.saving
			.catch((error: unknown) => {
				if (this.store.retryable?.(error) !== true) {
					throw error;
				}
			})
			.then(() => this.store.write([...this.ids]));
		void this.saving.catch(() => {});
	}
	/** 呼出し前の保存を確認し、再試行可能な競合だけを最新の所有 ID で再保存する。 */
	flush(): Promise<void> {
		this.saving = this.saving.catch((error: unknown) => {
			if (this.store.retryable?.(error) !== true) {
				throw error;
			}
			return this.store.write([...this.ids]);
		});
		void this.saving.catch(() => {});
		return this.saving;
	}
	/** 別ウィンドウで登録された会話も、手動操作を受ける前に照合する。 */
	async refresh(): Promise<void> {
		if (this.store.refresh) {
			const ids = z
				.array(z.string().min(1).max(8192))
				.parse(await this.store.refresh());
			for (const id of ids) {
				this.ids.add(id);
			}
		}
	}
}

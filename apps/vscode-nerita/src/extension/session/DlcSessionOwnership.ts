// DLC が所有するネイティブ会話を Host の利用者領域に記録し、再起動後の手動利用も拒否する。
import { z } from "zod";

/** 保存が完了するまではモデルへ送信しない。失敗した保存は以後の送信も拒否する。 */
export class DlcSessionOwnership {
	private ids: Set<string>;
	private saving = Promise.resolve();
	constructor(
		private store: { read(): unknown; write(ids: string[]): PromiseLike<void> },
	) {
		this.ids = new Set(
			z.array(z.string().min(1).max(8192)).parse(store.read() ?? []),
		);
	}
	has(sessionId: string): boolean {
		return this.ids.has(sessionId);
	}
	remember(sessionId: string): void {
		if (this.ids.has(sessionId)) {
			return;
		}
		this.ids.add(sessionId);
		const ids = [...this.ids];
		this.saving = this.saving.then(() => this.store.write(ids));
		void this.saving.catch(() => {});
	}
	flush(): Promise<void> {
		return this.saving;
	}
}

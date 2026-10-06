// 受信した Webview 要求の ID を記録し、同じ ID の要求の再実行を防ぐ。

/** 要求 ID は最大2048件保持し、上限を超えたら最も古い ID を記録から削除する。 */
export class RequestDeduplicator {
	private seen = new Set<string>();

	/** 記録にない ID を登録して受け付ける。記録済みの ID は拒否する。 */
	accept(id: string): boolean {
		if (this.seen.has(id)) {
			return false;
		}
		this.seen.add(id);
		if (this.seen.size > 2048) {
			this.seen.delete(this.seen.values().next().value!);
		}
		return true;
	}
}

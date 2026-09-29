// 同じ Host の別パネルで実行中の Pi 会話を、参照元から除外する。
const running = new Set<string>();

/** 送信準備から完了までの実行状態を会話 ID ごとに記録する。 */
export function setPiSessionRunning(id: string, active: boolean): void {
	if (active) {
		running.add(id);
	} else {
		running.delete(id);
	}
}

/** 読み込み前後に実行中の会話でないことを確認する。 */
export function isPiSessionRunning(id: string): boolean {
	return running.has(id);
}

// 開始応答より早い通知・承認と、サーバーの実行開始を一つのターンに束ねる。
import type { TurnEvent } from "./turnEvents";

/** UI の実行寿命に対応する、応答待ちと取消可能なターン状態。 */
export class ActiveTurn {
	readonly streams = new Map<string, Map<string, string>>();
	turnId: string | undefined;
	started = false;
	interruptSent = false;
	readonly events: TurnEvent[] = [];
	readonly abort = new AbortController();
	readonly completedItems = new Set<string>();
	release!: () => void;
	readonly ready = new Promise<void>((resolve) => {
		this.release = resolve;
	});
	/** 開始前から thread の範囲を固定する。 */
	constructor(readonly threadId: string) {}
}

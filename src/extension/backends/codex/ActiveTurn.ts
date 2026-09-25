// 開始応答より先に届く通知を保持し、ターンの開始状態と取消を管理する。
import type { TurnEvent } from "./items/turnEvents";

/** 開始応答の待機、通知の蓄積、取消に使うターン単位の状態。 */
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
	/** 実行開始前に対象のスレッド ID を固定する。 */
	constructor(readonly threadId: string) {}
}

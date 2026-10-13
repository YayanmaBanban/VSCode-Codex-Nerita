// コマンド実行の各区間を数値だけで記録する。コマンド・入力・パス・資格情報は計測記録に含めない。
import { performance } from "node:perf_hooks";

/** MXC 実行の計測結果。時間はミリ秒、最大常駐メモリーは KiB で扱い、未取得の初回出力は `null` とする。 */
export type MxcMeasurement = {
	temporaryMs: number;
	discoveryMs: number;
	storageMs: number;
	policyMs: number;
	spawnMs: number;
	firstOutputMs: number | null;
	executionMs: number;
	denialsMs: number;
	cleanupMs: number;
	totalMs: number;
	hostCpuMs: number;
	hostPeakRssKiB: number;
};
const recent: MxcMeasurement[] = [];
/** 最近の MXC 計測結果を返す。取得側による変更が内部の記録へ反映されないよう複製する。 */
export function mxcMeasurements(): MxcMeasurement[] {
	return structuredClone(recent);
}

/** 完了・停止・起動失敗のいずれでも、専用の一時領域の回収後に計測値を確定する。 */
export class MxcTiming {
	readonly value: MxcMeasurement = {
		temporaryMs: 0,
		discoveryMs: 0,
		storageMs: 0,
		policyMs: 0,
		spawnMs: 0,
		firstOutputMs: null,
		executionMs: 0,
		denialsMs: 0,
		cleanupMs: 0,
		totalMs: 0,
		hostCpuMs: 0,
		hostPeakRssKiB: 0,
	};
	private started = performance.now();
	private cpu = process.cpuUsage();
	/** 成功・失敗の両方で処理時間を加算し、元の戻り値と例外はそのまま伝える。 */
	async measure<T>(
		key:
			| "temporaryMs"
			| "discoveryMs"
			| "storageMs"
			| "executionMs"
			| "denialsMs"
			| "cleanupMs",
		operation: () => Promise<T>,
	): Promise<T> {
		const start = performance.now();
		try {
			return await operation();
		} finally {
			this.value[key] += performance.now() - start;
		}
	}
	/** 終了時の実測を複製して通知し、直近の記録だけを保持して Host の状態と外部の参照を分ける。 */
	finish(notify?: (value: MxcMeasurement) => void): void {
		const cpu = process.cpuUsage(this.cpu);
		this.value.totalMs = performance.now() - this.started;
		this.value.hostCpuMs = (cpu.user + cpu.system) / 1000;
		this.value.hostPeakRssKiB = process.resourceUsage().maxRSS;
		recent.push(structuredClone(this.value));
		if (recent.length > 30) {
			recent.shift();
		}
		notify?.(structuredClone(this.value));
	}
}

// Codex 本体への接続の計測点、固定コマンド、数値だけの集計を管理する。
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { performance } from "node:perf_hooks";
import { z } from "zod";

export type Trace = {
	marks: Record<string, number>;
	child?: ChildProcessWithoutNullStreams;
};
export const traces = new AsyncLocalStorage<Trace>();

/** ビルド時に計測用コピーだけへ挿入する。RPC 本文と設定は記録しない。 */
export function mark(stage: string) {
	const trace = traces.getStore();
	assert.ok(trace);
	trace.marks[stage] = performance.now();
}

export function recordProcess(child: ChildProcessWithoutNullStreams) {
	const trace = traces.getStore();
	assert.ok(trace);
	trace.child = child;
	mark("spawned");
}

export type Sample = {
	trial: number;
	persistentCache: boolean;
	target: "main" | "A" | "B";
	phase: "first" | "repeat" | "parallelFirst" | "parallelRepeat";
	cacheHit: boolean;
	metrics: Record<string, number>;
};

/** 失敗を成功の中央値へ混ぜず、要求条件と待ち時間だけを保存する。 */
export type Failure = Pick<
	Sample,
	"trial" | "persistentCache" | "target" | "phase"
> & {
	category: "permissionDenied";
	elapsedMs: number;
};

/** 小標本の範囲も保存し、中央値だけを確定的な改善率と扱わない。 */
export function summarize(samples: Sample[]) {
	const groups = new Map<string, Sample[]>();
	for (const sample of samples) {
		const key = `${sample.persistentCache}:${sample.phase}`;
		groups.set(key, [...(groups.get(key) ?? []), sample]);
	}
	return [...groups.values()].map((group) => ({
		persistentCache: group[0]!.persistentCache,
		phase: group[0]!.phase,
		count: group.length,
		cacheHits: group.filter((sample) => sample.cacheHit).length,
		metrics: summarizeMetrics(group),
	}));
}

function summarizeMetrics(group: Sample[]) {
	return Object.fromEntries(
		Object.keys(group[0]!.metrics).map((key) => [
			key,
			statistics(group.map((sample) => sample.metrics[key]!)),
		]),
	);
}

export function statistics(values: number[]) {
	assert.ok(values.length > 0 && values.every(Number.isFinite));
	const sorted = [...values].sort((a, b) => a - b);
	const center = Math.floor(sorted.length / 2);
	return {
		median:
			sorted.length % 2 === 0
				? (sorted[center - 1]! + sorted[center]!) / 2
				: sorted[center]!,
		min: sorted[0]!,
		max: sorted.at(-1)!,
	};
}

const nodeProbe = z.object({
	entryMs: z.number(),
	finishedMs: z.number(),
	workMs: z.number().nonnegative(),
	hit: z.boolean(),
	cpuMs: z.number().nonnegative(),
	rssKiB: z.number().nonnegative(),
});

export function parseOutput(stdout: string) {
	const lines = stdout.trim().split(/\r?\n/);
	const begin = lines.find((line) => line.startsWith("SHELL_BEGIN="));
	const end = lines.find((line) => line.startsWith("SHELL_END="));
	const node = lines.find((line) => line.startsWith("NODE_PROBE="));
	assert.ok(begin !== undefined && end !== undefined && node !== undefined);
	const shellBegin = Number(begin.slice("SHELL_BEGIN=".length));
	const shellEnd = Number(end.slice("SHELL_END=".length));
	assert.ok(Number.isFinite(shellBegin) && Number.isFinite(shellEnd));
	return {
		shellBegin,
		shellEnd,
		node: nodeProbe.parse(JSON.parse(node.slice("NODE_PROBE=".length))),
	};
}

// PowerShell 本文と Node 本文を UTC で対応付け、I/O 本文だけは単調増加時計で測る。
export const shellCommand = `Write-Output ('SHELL_BEGIN=' + [long](([DateTime]::UtcNow.Ticks - 621355968000000000) / 10000)); & $env:NERITA_MEASUREMENT_NODE probe.cjs; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; Write-Output ('SHELL_END=' + [long](([DateTime]::UtcNow.Ticks - 621355968000000000) / 10000))`;
export const probeSource = `const entryMs = Date.now();
const clock = performance.now();
const initialCpu = process.cpuUsage();
const fs = require('node:fs');
if (fs.realpathSync(process.cwd()).toLowerCase() !== fs.realpathSync(process.env.NERITA_MEASUREMENT_CWD).toLowerCase()) throw new Error('cwd mismatch');
const file = require('node:path').join(process.env.NPM_CONFIG_CACHE, 'fixed-probe.bin');
fs.mkdirSync(require('node:path').dirname(file), {recursive: true});
const content = Buffer.alloc(64 * 1024, 17);
const hit = fs.existsSync(file);
if (!hit) fs.writeFileSync(file, content);
const restored = fs.readFileSync(file);
if (!restored.equals(content)) throw new Error('cache mismatch');
require('node:crypto').createHash('sha256').update(restored).digest('hex');
const usedCpu = process.cpuUsage(initialCpu);
console.log('NODE_PROBE=' + JSON.stringify({entryMs, finishedMs: Date.now(), workMs: performance.now() - clock, hit, cpuMs: (usedCpu.user + usedCpu.system) / 1000, rssKiB: process.resourceUsage().maxRSS}));
`;

// 計測用コピーのランチャーへ数値だけの記録を追加する。出力本文・設定・パスは結果に含めない。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { MxcMeasurement } from "../../apps/vscode-nerita/src/extension/runtime/MxcTiming";

type BaseSample = MxcMeasurement & {
	variant: "baseline" | "optimized";
	persistentCache: boolean;
	trial: number;
	phase: "first" | "repeat" | "warmup" | "parallel";
	approvalMs: number;
	requestMs: number;
	requestPreparationMs: number;
	requestFirstOutputMs: number;
};
export type Sample = BaseSample & {
	launcherBootMs: number;
	launcherSetupMs: number;
	launcherDrainMs: number;
	mxcToShellMs: number;
	mxcAfterShellMs: number;
	mxcProcessMs: number;
	shellCommandMs: number;
	nodeStartupMs: number;
	nodeBodyMs: number;
	cacheHit: boolean;
	launcherCpuMs: number;
	launcherPeakRssKiB: number;
	mxcCpuMs: number;
	mxcPeakRssKiB: number;
	nodeCpuMs: number;
	nodePeakRssKiB: number;
};
const number = z.number().nonnegative();
const launcherSchema = z.object({
	enteredMs: number,
	nativeStartedMs: number,
	nativeExitedMs: number,
	reportingMs: number,
	launcherCpuMs: number,
	launcherPeakRssKiB: number,
	mxcCpuMs: number,
	mxcPeakRssKiB: number,
});
const probeSchema = z.object({
	entryMs: number,
	exitMs: number,
	bodyMs: number,
	cacheHit: z.boolean(),
	cpuMs: number,
	peakRssKiB: number,
});

/** 製品ランチャーの安全境界は変更せず、CLI が終了した後に専用 Host 領域へ書く。 */
export function instrumentLauncher(
	source: string,
	destination: string,
): string {
	const script = replace(
		`\uFEFF${source.replace(/^\uFEFF/u, "")}`,
		"$ErrorActionPreference = 'Stop'",
		"$ErrorActionPreference = 'Stop'\n$measurementEntered = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()",
	);
	const started = replace(
		script,
		"$child = [System.Diagnostics.Process]::Start($start)",
		"$measurementNativeStarted = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()\n    $child = [System.Diagnostics.Process]::Start($start)",
	);
	const eventWait = source.includes("Task]::WaitAny($waits)");
	const wait = eventWait
		? "$index = [System.Threading.Tasks.Task]::WaitAny($waits)"
		: "$index = [System.Threading.Tasks.Task]::WaitAny($connections, 100)";
	// 比較中も同じ間隔でメモリを読む。終了イベントはタイムアウト前に待機を解除する。
	const measuredWait = eventWait
		? "$index = [System.Threading.Tasks.Task]::WaitAny($waits, 100)\n        if ($index -lt 0) { continue }"
		: wait;
	const sampled = replace(
		started,
		wait,
		`$child.Refresh()\n        $measurementNativePeak = [Math]::Max($measurementNativePeak, $child.PeakWorkingSet64)\n        ${measuredWait}`,
	);
	const initialized = replace(
		sampled,
		"$child = $null",
		"$child = $null\n$measurementNativePeak = 0",
	);
	const file = destination.replaceAll("'", "''");
	return replace(
		initialized,
		"exit $child.ExitCode",
		`
    $self = [System.Diagnostics.Process]::GetCurrentProcess()
    $measurement = @{
        enteredMs = $measurementEntered
        nativeStartedMs = $measurementNativeStarted
        nativeExitedMs = ([DateTimeOffset]$child.ExitTime.ToUniversalTime()).ToUnixTimeMilliseconds()
        reportingMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        launcherCpuMs = $self.TotalProcessorTime.TotalMilliseconds
        launcherPeakRssKiB = $self.PeakWorkingSet64 / 1024
        mxcCpuMs = $child.TotalProcessorTime.TotalMilliseconds
        mxcPeakRssKiB = $measurementNativePeak / 1024
    }
    [System.IO.File]::WriteAllText('${file}', ($measurement | ConvertTo-Json -Compress))
    exit $child.ExitCode`,
	);
}

function replace(source: string, old: string, next: string): string {
	assert.equal(
		source.split(old).length,
		2,
		`ランチャーの計測位置が変わりました: ${old}`,
	);
	return source.replace(old, next);
}

/** 固定コマンドの時刻だけを解析する。本文や private ファイルのパスは結果へ返さない。 */
export async function parseProbe(
	result: Awaited<ReturnType<ToolDefinition["execute"]>>,
	timingPath: string,
	launchWall: number,
	base: BaseSample,
): Promise<Sample> {
	const text = result.content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n");
	assert.match(text, /Exit code: 0/u, text);
	const begin = marker(text, "SHELL_BEGIN");
	const end = marker(text, "SHELL_END");
	const node = probeSchema.parse(
		JSON.parse(text.match(/NODE_PROBE=(\{[^\r\n]+\})/u)?.[1] ?? "null"),
	);
	const launcher = launcherSchema.parse(
		JSON.parse(await readFile(timingPath, "utf8")),
	);
	const sample: Sample = {
		...base,
		launcherBootMs: launcher.enteredMs - launchWall,
		launcherSetupMs: launcher.nativeStartedMs - launcher.enteredMs,
		launcherDrainMs: launcher.reportingMs - launcher.nativeExitedMs,
		mxcToShellMs: begin - launcher.nativeStartedMs,
		mxcAfterShellMs: launcher.nativeExitedMs - end,
		mxcProcessMs: launcher.nativeExitedMs - launcher.nativeStartedMs,
		shellCommandMs: end - begin,
		nodeStartupMs: node.entryMs - begin,
		nodeBodyMs: node.bodyMs,
		cacheHit: node.cacheHit,
		launcherCpuMs: launcher.launcherCpuMs,
		launcherPeakRssKiB: launcher.launcherPeakRssKiB,
		mxcCpuMs: launcher.mxcCpuMs,
		mxcPeakRssKiB: launcher.mxcPeakRssKiB,
		nodeCpuMs: node.cpuMs,
		nodePeakRssKiB: node.peakRssKiB,
	};
	for (const [key, value] of Object.entries(sample)) {
		if (typeof value === "number") {
			assert.ok(Number.isFinite(value) && value >= 0, `${key}: ${value}`);
		}
	}
	assert.ok(base.requestMs >= base.totalMs + base.approvalMs);
	assert.ok(base.requestFirstOutputMs > base.approvalMs);
	assert.ok(
		sample.mxcPeakRssKiB > 0,
		"MXC 実行中のメモリを取得できませんでした。",
	);
	return sample;
}

function marker(text: string, name: string): number {
	const value = text.split(`${name}=`)[1]?.split(/\r?\n/u)[0];
	assert.ok(value !== undefined, `${name} がありません。`);
	return number.parse(Number(value));
}

/** 少数標本の p95 は最大値に近いため、中央値と範囲を提示する。 */
export function summarize(samples: Sample[]) {
	return [...new Set(samples.map((sample) => sample.variant))].flatMap(
		(variant) =>
			summarizeVariant(
				samples.filter((sample) => sample.variant === variant),
			).map((item) => ({ variant, ...item })),
	);
}

function summarizeVariant(samples: Sample[]) {
	const summary = [];
	for (const persistent of [false, true]) {
		for (const phase of ["first", "repeat", "parallel"] as const) {
			const selected = samples.filter(
				(sample) =>
					sample.persistentCache === persistent &&
					sample.phase === phase,
			);
			const numeric = [
				"requestMs",
				"approvalMs",
				"totalMs",
				"requestPreparationMs",
				"discoveryMs",
				"storageMs",
				"policyMs",
				"launcherBootMs",
				"launcherSetupMs",
				"mxcToShellMs",
				"shellCommandMs",
				"nodeStartupMs",
				"nodeBodyMs",
				"mxcAfterShellMs",
				"launcherDrainMs",
				"cleanupMs",
				"requestFirstOutputMs",
				"hostCpuMs",
				"launcherCpuMs",
				"mxcCpuMs",
				"nodeCpuMs",
				"hostPeakRssKiB",
				"launcherPeakRssKiB",
				"mxcPeakRssKiB",
				"nodePeakRssKiB",
			] as const;
			const metrics = Object.fromEntries(
				numeric.map((key) => [
					key,
					statistics(selected.map((sample) => sample[key])),
				]),
			);
			summary.push({
				persistentCache: persistent,
				phase,
				count: selected.length,
				cacheHits: selected.filter((sample) => sample.cacheHit).length,
				metrics,
			});
		}
	}
	return summary;
}

function statistics(values: number[]) {
	assert.ok(values.length > 0);
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	const median =
		sorted.length % 2 === 0
			? (sorted[middle - 1]! + sorted[middle]!) / 2
			: sorted[middle]!;
	return { median, min: sorted[0], max: sorted.at(-1) };
}

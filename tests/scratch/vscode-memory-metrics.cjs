// Webview の CDP と Windows のプロセスメモリを対応付けて記録する。
const { execFileSync } = require("node:child_process");
const { once } = require("node:events");

/** 一時的な Chromium トレースからフレームとレンダラープロセスの対応だけ取り出す。 */
async function rendererMapping(browserSession, frameSession, chat) {
	const events = [];
	const collect = (event) => events.push(...event.value);
	browserSession.on("Tracing.dataCollected", collect);
	await browserSession.send("Tracing.start", {
		categories:
			"devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing",
		transferMode: "ReportEvents",
	});
	await chat.evaluate(() => {
		globalThis.performance.mark("nerita-memory-frame");
		globalThis.console.timeStamp("nerita-memory-frame");
		return new Promise(globalThis.requestAnimationFrame);
	});
	const finished = once(browserSession, "Tracing.tracingComplete");
	await browserSession.send("Tracing.end");
	await finished;
	browserSession.off("Tracing.dataCollected", collect);
	const { frameTree } = await frameSession.send("Page.getFrameTree");
	const frames = events.flatMap((event) => event.args?.data?.frames ?? []);
	const frame = frames.find((entry) => entry.frame === frameTree.frame.id);
	const marker = events.find(
		(event) =>
			event.name === "nerita-memory-frame" ||
			event.args?.data?.message === "nerita-memory-frame",
	);
	return {
		frameId: frameTree.frame.id,
		rendererPid: frame?.processId ?? marker?.pid,
		frames: frames.map(({ frame: id, processId }) => ({ id, processId })),
		marker: marker && { name: marker.name, pid: marker.pid },
		eventNames: [...new Set(events.map((event) => event.name))],
	};
}

/** Extension Host 配下の Codex プロセスと、指定した Chromium プロセスの使用量を読む。 */
function windowsMemory(ids) {
	const command = [
		"$ErrorActionPreference='Stop'",
		"$taskIds=@($env:MEMORY_PROCESS_IDS.Split(',') | ForEach-Object { [int]$_ })",
		"$taskChildren=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId='+$env:MEMORY_HOST_PID))",
		"$codexIds=@($taskChildren | Where-Object Name -eq 'codex.exe' | ForEach-Object ProcessId)",
		"$taskIds+= $codexIds",
		"$values=@(Get-Process -Id ($taskIds | Select-Object -Unique) -ErrorAction SilentlyContinue | ForEach-Object { [PSCustomObject]@{ pid=$_.Id; name=$_.ProcessName; workingSetBytes=$_.WorkingSet64; privateBytes=$_.PrivateMemorySize64; codex=($codexIds -contains $_.Id) } })",
		"ConvertTo-Json -InputObject $values -Compress",
	].join("; ");
	return JSON.parse(
		execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
			windowsHide: true,
			encoding: "utf8",
			env: {
				...process.env,
				MEMORY_PROCESS_IDS: ids.join(","),
				MEMORY_HOST_PID: String(process.pid),
			},
		}),
	);
}

/** 通常操作での Webview のメモリ使用量と GC 後の値を、同じ条件で比較できるように保存する。 */
async function sample(context, label, collectGarbage) {
	const { frameSession, browserSession, rendererPid, chat } = context;
	if (collectGarbage) {
		await frameSession.send("HeapProfiler.collectGarbage");
	}
	const [heap, dom, processes, counts] = await Promise.all([
		frameSession.send("Runtime.getHeapUsage"),
		frameSession.send("Memory.getDOMCounters"),
		browserSession.send("SystemInfo.getProcessInfo"),
		chat.evaluate(() => ({
			messages: globalThis.document.querySelectorAll(".message").length,
			tools: globalThis.document.querySelectorAll(".tool-card").length,
			toolBodies: globalThis.document.querySelectorAll(
				".tool-card-collapse > div > *",
			).length,
			width: globalThis.innerWidth,
			height: globalThis.innerHeight,
		})),
	]);
	const renderers = processes.processInfo
		.filter((entry) => entry.type === "renderer")
		.map((entry) => entry.id);
	const native = windowsMemory([...renderers, process.pid]);
	const roles = native.map((entry) => ({
		...entry,
		role: processRole(entry, rendererPid),
	}));
	return {
		label,
		collectGarbage,
		time: new Date().toISOString(),
		counts,
		heap,
		dom,
		extensionHost: process.memoryUsage(),
		processes: roles,
	};
}

/** プロセスの対応が確認できたものだけ Webview として扱う。 */
function processRole(entry, rendererPid) {
	if (entry.pid === rendererPid) {
		return "webview";
	}
	if (entry.pid === process.pid) {
		return "extensionHost";
	}
	if (entry.codex) {
		return "codex";
	}
	return "otherRenderer";
}

module.exports = { rendererMapping, sample };

// 実 Pi SDK の親・子・孫 Runtime で、権限非拡大・履歴分離・親 `Stop` を検証する。
import assert from "node:assert/strict";
import { mkdir, realpath, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

/** 外部サブエージェント拡張を介さず、本番 Host API を模擬モデルから実行する。 */
export async function piSubagentSmoke({
	createPiRuntime,
	extensionPath,
	cwd,
	agentDir,
}) {
	const root = await realpath(cwd);
	const childRoot = path.join(root, "child");
	const external = path.join(path.dirname(root), "外部.txt");
	await writeFile(external, "EXTERNAL_READ_PROTECTED");
	await mkdir(childRoot);
	await writeFile(path.join(childRoot, "hello.txt"), "CHILD_READ_ALLOWED");
	const abort = new AbortController();
	const options = {
		extensionPath,
		cwd: root,
		agentDir,
		signal: abort.signal,
		preferredModel: { provider: "local", model: "smoke" },
	};
	const parent = await createPiRuntime({
		...options,
		role: { writableRoots: [], shell: false },
	});
	try {
		const child = await parent.children.open({
			cwd: childRoot,
			role: { writableRoots: [root], networkAccess: true, shell: true },
		});
		const grandchild = await child.children.open({
			role: { writableRoots: [root], networkAccess: true, shell: true },
		});
		for (const runtime of [child, grandchild]) {
			assert.equal(runtime.history, undefined);
			assert.deepEqual(runtime.accessPolicy.writableRoots, []);
			assert.equal(runtime.accessPolicy.networkAccess, false);
			assert.equal(runtime.accessPolicy.shell, false);
			await toolResult(
				runtime,
				"read",
				{ path: "hello.txt" },
				false,
				/CHILD_READ_ALLOWED/,
			);
			await toolResult(
				runtime,
				"read",
				{ path: "../hello.txt" },
				false,
				/Pi read tool works/,
			);
			await toolResult(
				runtime,
				"write",
				{ path: "unexpected.txt", content: "bad" },
				true,
				/境界/,
			);
			await toolResult(
				runtime,
				"powershell",
				{ command: "Write-Output forbidden" },
				true,
				/role/,
			);
		}
		await parent.abort();
		await assert.rejects(child.children.open({ role: {} }));
		await assert.rejects(grandchild.children.open({ role: {} }));
	} finally {
		await parent.close();
	}

	let asked;
	const waiting = new Promise((resolve) => {
		asked = resolve;
	});
	const writableParent = await createPiRuntime({
		...options,
		authorize: (_title, signal) =>
			new Promise((_resolve, reject) => {
				signal.throwIfAborted();
				signal.addEventListener(
					"abort",
					() => reject(new Error("parent stopped")),
					{ once: true },
				);
				asked();
			}),
	});
	try {
		const child = await writableParent.children.open({
			cwd: childRoot,
			role: {},
		});
		const grandchild = await child.children.open({ role: {} });
		await toolResult(
			writableParent,
			"read",
			{ path: external },
			true,
			/ガードレールが実行を拒否/,
		);
		await toolResult(
			writableParent,
			"write",
			{ path: external, content: "bad" },
			true,
			/境界/,
		);
		assert.equal(
			await readFile(external, "utf8"),
			"EXTERNAL_READ_PROTECTED",
		);
		const running = toolResult(
			grandchild,
			"write",
			{ path: "after-stop.txt", content: "bad" },
			true,
			/stopped|abort/i,
		);
		await waiting;
		await writableParent.abort();
		await running;
		await assert.rejects(readFile(path.join(childRoot, "after-stop.txt")), {
			code: "ENOENT",
		});
	} finally {
		await writableParent.close();
	}
	await runningChildStop(createPiRuntime, options, childRoot);
	console.log(
		"PASS: live Pi child/grandchild → role intersection → external read denied → no history → parent Stop during approval",
	);
}

/** 実行中の孫シェルも親 `Stop` で回収し、ファイル更新が止まることを確認する。 */
async function runningChildStop(createPiRuntime, options, cwd) {
	const parent = await createPiRuntime({
		...options,
		authorize: (_title, signal) => Promise.resolve(signal),
	});
	try {
		const child = await parent.children.open({ cwd, role: {} });
		const grandchild = await child.children.open({ role: {} });
		const counter = path.join(cwd, "grandchild-counter.txt");
		const running = grandchild.prompt(
			`policy:${JSON.stringify({ name: "powershell", args: { command: "while ($true) { Add-Content -LiteralPath grandchild-counter.txt -Value tick; Start-Sleep -Milliseconds 80 }" } })}`,
		);
		const started = Date.now();
		while (!(await readFile(counter).catch(() => undefined))) {
			assert.ok(
				Date.now() - started < 20000,
				"孫Shellが開始しませんでした",
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		await parent.abort();
		await running;
		const stopped = await readFile(counter, "utf8");
		await new Promise((resolve) => setTimeout(resolve, 400));
		assert.equal(await readFile(counter, "utf8"), stopped);
	} finally {
		await parent.close();
	}
}

/** モデルがツールを呼び出した後、SDK が返すツール実行の終了通知を確認する。 */
async function toolResult(runtime, name, args, isError, pattern) {
	const results = [];
	const unsubscribe = runtime.subscribe((event) => {
		if (event.type === "tool_execution_end") {
			results.push(event);
		}
	});
	try {
		await runtime.prompt(`policy:${JSON.stringify({ name, args })}`);
		assert.equal(results.length, 1, `${name}: missing tool result`);
		assert.equal(results[0].isError, isError, JSON.stringify(results[0]));
		assert.match(JSON.stringify(results[0].result), pattern);
	} finally {
		unsubscribe();
	}
}

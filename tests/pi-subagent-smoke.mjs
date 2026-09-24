// 実Pi SDKの親・子・孫でToolを動かし、role指定からの権限拡大と停止漏れを検出する。
import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

/** ローカル模擬モデルを使い、認証や外部subagent拡張なしで親の上限を検証する。 */
export async function piSubagentSmoke({
	createPiRuntime,
	extensionPath,
	cwd,
	agentDir,
}) {
	const root = await realpath(cwd);
	const childRoot = path.join(root, "child");
	await mkdir(childRoot);
	await writeFile(path.join(childRoot, "hello.txt"), "CHILD_READ_ALLOWED");
	await writeFile(
		path.join(childRoot, "protected.txt"),
		"SYNTHETIC_PROTECTED",
	);
	const parentPolicy = {
		filesystem: {
			readableRoots: [root],
			writableRoots: [],
			protectedPaths: [path.join(childRoot, "protected.txt")],
		},
		network: { enabled: false },
		command: { mode: "deny" },
	};
	const options = {
		extensionPath,
		cwd: root,
		agentDir,
		parentPolicy,
		signal: new AbortController().signal,
		preferredModel: { provider: "local", model: "smoke" },
	};
	const parent = await createPiRuntime(options);
	const permissive = {
		filesystem: {
			readableRoots: [root],
			writableRoots: [root],
			protectedPaths: [],
		},
		network: { enabled: true },
		command: { mode: "host" },
	};
	try {
		// 親の呼出元が起動後に書き換えたpolicyを子へ継承してはならない。
		parentPolicy.filesystem.writableRoots.push(root);
		parentPolicy.filesystem.protectedPaths.length = 0;
		parentPolicy.network.enabled = true;
		parentPolicy.command.mode = "host";
		const child = await parent.createChild({
			cwd: childRoot,
			accessPolicy: {
				...permissive,
				filesystem: {
					...permissive.filesystem,
					readableRoots: [childRoot],
				},
			},
		});
		const grandchild = await child.createChild({
			accessPolicy: permissive,
		});
		assert.equal(child.history, undefined);
		assert.equal(grandchild.history, undefined);
		await assert.rejects(
			child.createChild({ cwd: root, accessPolicy: permissive }),
			/境界/,
		);
		for (const runtime of [child, grandchild]) {
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
				true,
				/境界/,
			);
			await toolResult(
				runtime,
				"read",
				{ path: "protected.txt" },
				true,
				/保護/,
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
				/not found|not available|unknown tool/i,
			);
		}
		await assert.rejects(readFile(path.join(childRoot, "unexpected.txt")), {
			code: "ENOENT",
		});
		await parent.abort();
		await assert.rejects(child.createChild({ accessPolicy: permissive }));
		await assert.rejects(
			grandchild.createChild({ accessPolicy: permissive }),
		);
	} finally {
		parent.dispose();
	}

	// 承認待ちの子を親Stopから取消し、承認後に処理が再開しないことを確かめる。
	let asked;
	const waiting = new Promise((resolve) => {
		asked = resolve;
	});
	const writableParent = await createPiRuntime({
		...options,
		parentPolicy: { ...permissive, command: { mode: "deny" } },
		authorize: (_title, signal) =>
			new Promise((_resolve, reject) => {
				assert.ok(signal);
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
		const reviewer = await writableParent.createChild({
			cwd: childRoot,
			accessPolicy: {
				...permissive,
				filesystem: { ...permissive.filesystem, writableRoots: [] },
			},
		});
		await toolResult(
			reviewer,
			"write",
			{ path: "reviewer-write.txt", content: "bad" },
			true,
			/境界/,
		);
		reviewer.dispose();
		const child = await writableParent.createChild({
			cwd: childRoot,
			accessPolicy: permissive,
		});
		const running = toolResult(
			child,
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
		writableParent.dispose();
	}
	console.log(
		"PASS: live Pi child/grandchild policy intersection, protected paths, parent snapshot, parent Stop",
	);
}

/** 実SDKがモデルのTool要求を実行し終えたイベントを検証する。 */
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

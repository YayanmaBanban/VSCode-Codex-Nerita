// MXC の Node / Git と Host 承認済み native pnpm を組み合わせ、開発コマンドを実行する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, writeFile, mkdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolSummary } from "@nerita/shared/chatState";
import type { AgentThreadView } from "@nerita/shared/subAgents";
import { piFixture, send, permission, finished, until } from "../support/pi";
import type { PiSessionController } from "../../apps/vscode-nerita/src/extension/backends/pi/PiSessionController";
import { loadMxcSdk } from "../../apps/vscode-nerita/src/extension/runtime/MxcSdk";
import { MxcExecutor } from "../../apps/vscode-nerita/src/extension/runtime/MxcExecutor";

for (const route of ["child", "codemode"]) {
	for (const restricted of [false, true]) {
		void test(`native pnpm の Host 承認経路を継承し、role の制限を解除しない（${route} / restricted=${restricted}）`, async (t) => {
			const f = await piFixture(t);
			f.options.executor = new MxcExecutor(
				await loadMxcSdk(process.env.NERITA_TEST_EXTENSION!),
				"base-container",
			);
			if (restricted) {
				f.options.role = { writableRoots: [] };
			}
			await writeFile(
				join(f.cwd, "package.json"),
				JSON.stringify({ scripts: { probe: "node probe.cjs" } }),
			);
			await writeFile(
				join(f.cwd, "probe.cjs"),
				"require('node:fs').writeFileSync('host.txt', 'approved'); console.log('HOST_APPROVED');",
			);
			await queueHostExecution(f, route);
			const controller = f.controller();
			await controller.connect();
			await send(controller, "Host 実行を確認");
			await permission(controller, "accept");
			await until(
				() => controller.snapshot().permissions.length === 1,
				() => controller.snapshot(),
			);
			assert.equal(
				controller.snapshot().permissions[0]!.commandPermission?.route,
				"host",
			);
			await assert.rejects(readFile(join(f.cwd, "host.txt")), {
				code: "ENOENT",
			});
			await permission(controller, "accept");
			const state = await finished(controller);
			assert.equal(state.run, "completed");
			const commands = (await commandTools(controller, route)).filter(
				(tool) => tool.kind === "execute",
			);
			assert.equal(commands.length, 1);
			assert.equal(
				commands[0]!.status,
				restricted ? "failed" : "completed",
				"Host 実行は role の書込み制限を維持する",
			);
			if (restricted) {
				await assert.rejects(readFile(join(f.cwd, "host.txt")), {
					code: "ENOENT",
				});
			} else {
				assert.equal(
					await readFile(join(f.cwd, "host.txt"), "utf8"),
					"approved",
				);
			}
		});
	}
}

/** 子の会話は公開メッセージで取得し、Codemode の入れ子は親のカードから確認する。 */
async function commandTools(
	controller: PiSessionController,
	route: string,
): Promise<ToolSummary[]> {
	const state = controller.snapshot();
	if (route !== "child") {
		return state.tools;
	}
	assert.equal(state.agents.length, 1);
	let view: AgentThreadView | undefined;
	const requestId = "child-command";
	const unsubscribe = controller.subscribe((reply) => {
		if (reply.type === "agent/view" && reply.requestId === requestId) {
			view = reply.view;
		}
	});
	try {
		await controller.receive({
			type: "agent/read",
			requestId,
			sessionId: state.sessionId!,
			threadId: state.agents[0]!.threadId,
		});
	} finally {
		unsubscribe();
	}
	assert.ok(view);
	return view.tools;
}

/** 同じ pnpm ツールを子と Codemode から呼び、経路を独自実装しない。 */
async function queueHostExecution(
	f: Awaited<ReturnType<typeof piFixture>>,
	route: string,
) {
	if (route === "codemode") {
		f.options.codemode = true;
		f.model.replies.push(
			{
				name: "codemode",
				arguments: {
					code: 'text(await tools.pnpm({args:["run","probe"]}));',
				},
			},
			"完了",
		);
		return;
	}
	await mkdir(join(f.agentDir, "agents"));
	await writeFile(
		join(f.agentDir, "agents/worker.md"),
		"---\nname: worker\ndescription: 担当\ntools: pnpm, write\n---\n指定された処理を行う。\n",
	);
	f.model.replies.push(
		{
			name: "subagent",
			arguments: {
				agent: "worker",
				task: "pnpm を実行",
				context: "fork",
			},
		},
		{ name: "pnpm", arguments: { args: ["run", "probe"] } },
		"子の完了",
		"親の完了",
	);
}

void test("型チェック・テスト・Git は MXC、lint を含む pnpm は Host 承認で実行できる", async (t) => {
	const f = await piFixture(t);
	f.options.executor = new MxcExecutor(
		await loadMxcSdk(process.env.NERITA_TEST_EXTENSION!),
		"base-container",
	);
	await prepareProject(f.cwd);
	const controller = f.controller();
	await controller.connect();
	f.model.replies.push(
		{
			name: "powershell",
			arguments: {
				command:
					"node tools/typescript/lib/tsc.js --noEmit --strict --skipLibCheck sample.ts; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node --test sample.test.cjs; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git status --porcelain; exit $LASTEXITCODE",
			},
		},
		"確認完了",
	);
	await send(controller, "開発コマンドを確認");
	await permission(controller, "accept");
	let state = await finished(controller);
	assert.equal(state.tools.at(-1)!.exitCode, 0, JSON.stringify(state.tools));
	assert.equal(
		await readFile(join(f.cwd, "test-runs.txt"), "utf8"),
		"passed\n",
	);
	for (const failing of [false, true]) {
		if (failing) {
			await writeFile(
				join(f.cwd, "sample.ts"),
				'const value: number = "invalid";',
			);
		}
		f.model.replies.push(
			{ name: "pnpm", arguments: { args: ["run", "check"] } },
			"確認完了",
		);
		await send(controller, "pnpm で lint と型とテストを確認");
		await until(() => controller.snapshot().permissions.length === 1);
		const approval =
			controller.snapshot().permissions[0]!.commandPermission!;
		assert.equal(approval.route, "host");
		assert.equal(approval.commandClass, "execution");
		await permission(controller, "accept");
		state = await finished(controller);
		const tool = state.tools.at(-1)!;
		assert.equal(
			tool.exitCode === 0,
			!failing,
			JSON.stringify(tool.output),
		);
		assert.equal(
			await readFile(join(f.cwd, "test-runs.txt"), "utf8"),
			"passed\npassed\n",
		);
		if (failing) {
			assert.ok(tool.output!.preview.includes("TS2322"));
		}
	}
});

/** 外部通信なしで実行できる小さなプロジェクトを、テスト専用ワークスペースに作る。 */
async function prepareProject(cwd: string) {
	const require = createRequire(
		join(process.env.NERITA_TEST_REPO_ROOT!, "package.json"),
	);
	await cp(
		dirname(require.resolve("typescript/package.json")),
		join(cwd, "tools/typescript"),
		{ recursive: true },
	);
	const eslint = join(
		dirname(require.resolve("eslint/package.json")),
		"bin/eslint.js",
	);
	await writeFile(
		join(cwd, "package.json"),
		JSON.stringify({
			scripts: {
				check: `node "${eslint}" sample.cjs && node tools/typescript/lib/tsc.js --noEmit --strict --skipLibCheck sample.ts && node --test sample.test.cjs && git status --porcelain`,
			},
		}),
	);
	await writeFile(
		join(cwd, "eslint.config.mjs"),
		'export default [{ rules: { "no-unused-vars": "error" } }];',
	);
	await writeFile(
		join(cwd, "sample.cjs"),
		"const value = 42; console.log(value);",
	);
	await writeFile(join(cwd, "sample.ts"), "const value: number = 42;");
	await writeFile(
		join(cwd, "sample.test.cjs"),
		'const assert = require("node:assert/strict"); require("node:test").test("fixture", () => { assert.equal(6 * 7, 42); require("node:fs").appendFileSync("test-runs.txt", "passed\\n"); });',
	);
	await promisify(execFile)("git", ["init", "--quiet", cwd], {
		windowsHide: true,
	});
}

// 同梱 SDK の親子 Runtime を起動し、実 Tool Call の承認と取消しを確認する。
import * as assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
	createPiRuntime,
	type PiRuntimeSession,
} from "./piTrustedRuntime";
import { guardrailRegistry } from "../src/extension/security/GuardrailRegistry";
import { defaultGuardrails } from "../src/shared/guardrails/config";
import type { PiAuthorize } from "../src/extension/backends/pi/PiApprovedTools";
import { guardrailsFixture } from "./piGuardrailsFixture";

/** 子の操作をモデル応答から発行し、拒否・失効後の実ファイルが変わらないことを検証する。 */
export async function piGuardrailsSmoke(extensionPath: string): Promise<void> {
	const fixture = await guardrailsFixture();
	const lifetime = new AbortController();
	let parent: PiRuntimeSession | undefined;
	let approvals = 0;
	let answer: PiAuthorize = () => Promise.resolve(lifetime.signal);
	const authorize: PiAuthorize = (presentation, signal) => {
		approvals++;
		return answer(presentation, signal);
	};
	try {
		parent = await createPiRuntime({
			extensionPath,
			cwd: fixture.cwd,
			agentDir: fixture.agentDir,
			signal: lifetime.signal,
			authorize,
			preferredModel: { provider: "local", model: "guard" },
			windowsSandbox: "elevated",
			executor: null,
			ephemeral: true,
		});
		const runtime = parent;
		const protectedPath = join(fixture.cwd, ".env");
		await writeFile(protectedPath, "fixture-secret");
		fixture.setTool("read", { path: ".env" });
		const reader = await runtime.children.open({ role: {} });
		const events: unknown[] = [];
		reader.subscribe((event) => events.push(event));
		await reader.prompt("read protected fixture");
		assert.equal(approvals, 0);
		assert.ok(JSON.stringify(events).includes("ガードレールが実行を拒否"));
		assert.ok(!JSON.stringify(events).includes("fixture-secret"));
		assert.equal(
			reader.accessPolicy.guardrailsRoot,
			runtime.accessPolicy.guardrailsRoot,
		);
		await reader.close();

		fixture.setTool("write", { path: "approved.txt", content: "original" });
		const writer = await runtime.children.open({ role: {} });
		await writer.prompt("write fixture");
		assert.equal(approvals, 1);
		assert.equal(
			await readFile(join(fixture.cwd, "approved.txt"), "utf8"),
			"original",
		);
		await writer.close();

		fixture.setTool("write", {
			path: "role-denied.txt",
			content: "forbidden",
		});
		const restricted = await runtime.children.open({
			role: { writableRoots: [], shell: false, networkAccess: false },
		});
		const grandchild = await restricted.children.open({
			role: {
				writableRoots: [fixture.cwd],
				shell: true,
				networkAccess: true,
			},
		});
		assert.deepEqual(grandchild.accessPolicy.writableRoots, []);
		assert.equal(grandchild.accessPolicy.shell, false);
		assert.equal(grandchild.accessPolicy.networkAccess, false);
		await grandchild.prompt("attempt write");
		assert.equal(approvals, 1);
		await assert.rejects(readFile(join(fixture.cwd, "role-denied.txt")), {
			code: "ENOENT",
		});
		await restricted.close();
		await assert.rejects(restricted.children.open({ role: {} }));

		for (const action of [
			"decline",
			"stop",
			"settings",
			"disconnect",
		] as const) {
			const target = join(fixture.cwd, `${action}.txt`);
			fixture.setTool("write", {
				path: `${action}.txt`,
				content: "forbidden",
			});
			let requested!: () => void;
			const waiting = new Promise<void>((resolve) => {
				requested = resolve;
			});
			answer = (_presentation, signal) =>
				new Promise((_resolve, reject) => {
					requested();
					if (action === "decline") {
						reject(new Error("fixture: declined"));
						return;
					}
					const abort = () => reject(new Error("fixture: cancelled"));
					signal?.addEventListener("abort", abort, { once: true });
					if (signal?.aborted) {
						abort();
					}
				});
			const child = await runtime.children.open({ role: {} });
			const running = child
				.prompt(`check ${action}`)
				.catch(() => undefined);
			await waiting;
			await assert.rejects(readFile(target), { code: "ENOENT" });
			if (action === "stop") {
				await runtime.abort();
			}
			if (action === "settings") {
				guardrailRegistry.apply(fixture.cwd, defaultGuardrails());
			}
			if (action === "disconnect") {
				lifetime.abort();
			}
			await running;
			await child.close();
			await assert.rejects(readFile(target), { code: "ENOENT" });
		}
		await assert.rejects(runtime.children.open({ role: {} }));
	} finally {
		lifetime.abort();
		await parent?.close();
		await fixture.close();
		guardrailRegistry.dispose();
		assert.equal(dirname(fixture.root), tmpdir());
		assert.ok(
			basename(fixture.root).startsWith("nerita-guard-integration-"),
		);
		await rm(fixture.root, { recursive: true, force: true });
	}
}

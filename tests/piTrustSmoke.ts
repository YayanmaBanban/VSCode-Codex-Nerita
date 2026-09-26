// 実 SDK の未信頼セッションで読取りと実行拒否を確認し、人の信頼後だけ書込みを許可する。
import * as assert from "node:assert/strict";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import {
	createPiRuntime,
	type PiRuntimeSession,
} from "../src/extension/backends/pi/PiRuntime";
import { WorkspaceTrustStore } from "../src/extension/security/trust/WorkspaceTrustStore";
import { guardrailsFixture } from "./piGuardrailsFixture";

/** モデルだけをローカルの固定応答に置き換え、製品 Runtime の既定拒否を使う。 */
export async function piTrustSmoke(extensionPath: string) {
	const fixture = await guardrailsFixture();
	const store = new WorkspaceTrustStore({
		read: () => undefined,
		write: async () => {},
	});
	let approvals = 0;
	let session: PiRuntimeSession | undefined;
	const open = () =>
		createPiRuntime({
			extensionPath,
			cwd: fixture.cwd,
			agentDir: fixture.agentDir,
			signal: new AbortController().signal,
			trustStore: store,
			workspaceTrusted: true,
			authorize: signalApproval,
			preferredModel: { provider: "local", model: "guard" },
			executor: null,
			ephemeral: true,
		});
	/** Trust を通過した操作だけを承認した件数として記録する。 */
	function signalApproval() {
		approvals++;
		return Promise.resolve(new AbortController().signal);
	}
	try {
		await writeFile(join(fixture.cwd, "read.txt"), "trust-read-marker");
		for (const [tool, params, marker] of [
			["read", { path: "read.txt" }, "trust-read-marker"],
			[
				"grep",
				{ pattern: "trust-read-marker", path: "read.txt" },
				"trust-read-marker",
			],
			[
				"write",
				{ path: "denied.txt", content: "must not exist" },
				"未信頼",
			],
			["powershell", { command: "pnpm test" }, "未信頼"],
		] as const) {
			fixture.setTool(tool, params);
			session = await open();
			const events: unknown[] = [];
			session.subscribe((event) => events.push(event));
			await session.prompt("run fixture");
			assert.ok(
				JSON.stringify(events).includes(marker),
				`${tool} result missing`,
			);
			await session.close();
			session = undefined;
		}
		assert.equal(approvals, 0);
		await assert.rejects(readFile(join(fixture.cwd, "denied.txt")), {
			code: "ENOENT",
		});
		await store.setUserTrust(fixture.cwd, true);
		fixture.setTool("write", {
			path: "approved.txt",
			content: "trusted-write",
		});
		session = await open();
		await session.prompt("write fixture");
		assert.equal(approvals, 1);
		assert.equal(
			await readFile(join(fixture.cwd, "approved.txt"), "utf8"),
			"trusted-write",
		);
		await store.setUserTrust(fixture.cwd, false);
		await assert.rejects(session.children.open({ role: {} }));
	} finally {
		await session?.close();
		await fixture.close();
		await cleanupRoot(fixture.root);
	}
}

/** 作成した専用ディレクトリ以外を削除しない。 */
async function cleanupRoot(root: string) {
	if (
		dirname(root) !== tmpdir() ||
		!basename(root).startsWith("nerita-guard-integration-")
	) {
		throw new Error("不正なfixture削除先");
	}
	await rm(root, { recursive: true, force: true });
}

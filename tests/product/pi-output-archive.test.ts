// SDK の一時シェル出力を恒久保存し、削除・改ざん後の参照境界を検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolSummary } from "@nerita/shared/chatState";
import { PiOutputArchive } from "../../apps/vscode-nerita/src/extension/backends/pi/results/PiOutputArchive";
import { ToolOutputStore } from "../../apps/vscode-nerita/src/extension/session/ToolOutputStore";

void test("一時シェル出力を保存し、元ファイルの削除後も全文と終了コードを復元する", async (t) => {
	const sdk = await loadSdk();
	const directory = await mkdtemp(
		join(process.env.NERITA_TEST_ROOT!, "output-archive-"),
	);
	const manager = sdk.SessionManager.create(directory, directory);
	const turnId = manager.appendMessage({
		role: "user",
		content: "実行",
		timestamp: Date.now(),
	});
	const archive = new PiOutputArchive(manager, directory);
	const temporary = join(
		tmpdir(),
		`pi-bash-${randomBytes(8).toString("hex")}.log`,
	);
	const text = `先頭🐈${"日本語".repeat(5000)}末尾`;
	await writeFile(temporary, text, "utf8");
	t.after(async () => {
		try {
			await unlink(temporary);
		} catch {
			// 復元の検証前に削除済み。
		}
	});
	archive.capture({
		type: "tool_execution_end",
		toolCallId: "shell",
		toolName: "bash",
		isError: true,
		result: {
			structuredContent: {
				output: "先頭…末尾",
				truncated: true,
				full_output_path: temporary,
				exit_code: 1,
			},
		},
	});
	await archive.flush();
	await unlink(temporary);
	const tool: ToolSummary = {
		id: "shell",
		runId: `history:${turnId}`,
		title: "bash",
		kind: "execute",
		status: "failed",
		paths: [],
	};
	archive.restore([tool], manager.getBranch());
	const store = new ToolOutputStore();
	t.after(() => store.dispose());
	const projected = store.project(tool);
	assert.equal(projected.exitCode, 1);
	assert.ok(projected.output?.outputRef);
	assert.equal(
		(
			await store.read({
				type: "tool/output",
				requestId: "read",
				outputRef: projected.output.outputRef,
				offset: 0,
				limit: 65536,
			})
		).text,
		text,
	);
	const record = manager.getBranch().find((entry) => entry.type === "custom");
	assert.ok(record?.type === "custom");
	const invalid = {
		...record,
		data: { ...(record.data as object), ownerSessionId: "../outside" },
	};
	assert.throws(
		() => archive.restore([{ ...tool }], [invalid]),
		/保存情報が破損/u,
	);
});

/** 配布用に束ねた SDK を使い、ユーザー環境の Pi は読み込まない。 */
async function loadSdk() {
	return (await import(
		pathToFileURL(
			join(process.env.NERITA_TEST_EXTENSION!, "dist/runtime/pi.mjs"),
		).href
	)) as typeof PiSdk;
}

// 承認・拒否・停止・信頼の取り消しを、SDK 本体によるファイル書き込みで検証する。
import assert from "node:assert/strict";
import {
	readFile,
	writeFile,
	mkdir,
	link,
	rename,
	symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { defaultGuardrails } from "@nerita/shared/guardrails/config";
import { validStateField } from "@nerita/shared/stateFieldValidation";
import { guardrailRegistry } from "../../apps/vscode-nerita/src/extension/security/GuardrailRegistry";
import { piFixture, send, permission, finished, until } from "../support/pi";
void test("許可前には書かず、許可後は一度だけ書く。重複要求を再実行しない", async (t) => {
	const f = await piFixture(t);
	f.model.replies.push(
		{
			name: "write",
			arguments: { path: "result.txt", content: "approved" },
		},
		"保存しました",
	);
	const controller = f.controller();
	await controller.connect();
	assert.equal(
		controller.snapshot().connection,
		"ready",
		controller.snapshot().error ?? "",
	);
	const request = await send(controller, "ファイルを作成");
	await until(() => controller.snapshot().permissions.length === 1);
	const permissions = controller.snapshot().permissions;
	assert.deepEqual(
		permissions[0]!.options.map(({ id, kind }) => ({ id, kind })),
		[
			{ id: "accept", kind: "allow" },
			{ id: "decline", kind: "deny" },
			{ id: "cancel", kind: "abort" },
		],
	);
	assert.ok(validStateField("permissions", permissions));
	assert.equal(
		validStateField("permissions", [
			{
				...permissions[0],
				options: [
					{ id: "accept", name: "今回のみ許可", kind: "unknown" },
				],
			},
		]),
		false,
	);
	await assert.rejects(readFile(join(f.cwd, "result.txt")), {
		code: "ENOENT",
	});
	await controller.receive(request);
	await permission(controller, "accept");
	const state = await finished(controller);
	assert.equal(state.error, null);
	assert.equal(await readFile(join(f.cwd, "result.txt"), "utf8"), "approved");
	assert.equal(state.tools.length, 1);
	assert.equal(state.tools[0]!.status, "completed");
	await controller.receive(request);
	await finished(controller);
	assert.equal(f.model.requests.length, 2, "同じ要求 ID を再実行しない");
});

for (const action of ["deny", "stop", "revoke", "settings"] as const) {
	void test(`${action} の後に古い許可を返してもファイルを作成しない`, async (t) => {
		const f = await piFixture(t);
		f.model.replies.push(
			{
				name: "write",
				arguments: { path: "forbidden.txt", content: "forbidden" },
			},
			"拒否を確認",
		);
		const controller = f.controller();
		await controller.connect();
		await send(controller, "承認待ちの操作");
		await until(
			() => controller.snapshot().permissions.length === 1,
			() => controller.snapshot(),
		);
		const state = controller.snapshot();
		const reply = {
			type: "permission/respond",
			requestId: "late",
			sessionId: state.sessionId,
			runId: state.runId,
			permissionId: state.permissions[0]!.id,
			optionId: "accept",
		};
		if (action === "deny") {
			await permission(controller, "decline");
		}
		if (action === "stop") {
			await controller.receive({
				type: "prompt/cancel",
				requestId: "stop",
				sessionId: state.sessionId,
				runId: state.runId,
			});
		}
		if (action === "revoke") {
			await f.trust.setUserTrust(f.cwd, false);
		}
		if (action === "settings") {
			const config = defaultGuardrails();
			config.pathRules.push({
				id: "block-write",
				reason: "承認待ちの対象を禁止する",
				action: "deny",
				base: "workspace",
				match: "file",
				pattern: "forbidden.txt",
				exceptions: [],
				operations: ["write"],
			});
			guardrailRegistry.apply(f.cwd, config);
		}
		await controller.receive(reply);
		await finished(controller);
		await controller.dispose();
		await assert.rejects(
			readFile(join(f.cwd, "forbidden.txt")),
			{
				code: "ENOENT",
			},
			"取消し後の古い許可では書き込まない",
		);
		assert.equal(controller.snapshot().permissions.length, 0);
		assert.ok(f.model.requests.length <= 2);
	});
}

for (const change of ["content", "hardlink", "ancestor", "junction"] as const) {
	void test(`承認待ちの ${change} 変更を拒否し、他の編集とリンク先の本文を保持する`, async (t) => {
		const f = await piFixture(t);
		const folder = join(f.cwd, "target");
		const file = join(folder, "result.txt");
		const preserved = join(f.cwd, "preserved");
		await mkdir(folder);
		await writeFile(file, "original");
		f.model.replies.push(
			{
				name: "write",
				arguments: {
					path: "target/result.txt",
					content: "stale overwrite",
				},
			},
			"拒否を確認",
		);
		const controller = f.controller();
		await controller.connect();
		await send(controller, "既存ファイルを更新");
		await until(() => controller.snapshot().permissions.length === 1);
		if (change === "content") {
			await writeFile(file, "concurrent edit");
		}
		if (change === "hardlink") {
			await link(file, join(f.cwd, "linked.txt"));
		}
		if (change === "ancestor" || change === "junction") {
			await rename(folder, preserved);
			if (change === "ancestor") {
				await mkdir(folder);
			} else {
				const outside = join(f.root, "outside");
				await mkdir(outside);
				await symlink(outside, folder, "junction");
			}
			await writeFile(file, "replacement");
		}
		await permission(controller, "accept");
		const state = await finished(controller);
		assert.equal(
			state.tools[0]!.status,
			"failed",
			"承認待ちの変更後は古い許可を拒否する",
		);
		const expected = {
			content: "concurrent edit",
			hardlink: "original",
			ancestor: "replacement",
			junction: "replacement",
		}[change];
		assert.equal(
			await readFile(file, "utf8"),
			expected,
			"承認した対象と異なる本文を上書きしない",
		);
		if (change === "ancestor" || change === "junction") {
			assert.equal(
				await readFile(join(preserved, "result.txt"), "utf8"),
				"original",
			);
		}
	});
}

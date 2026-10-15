// App Server の設定境界だけを代替し、信頼の保存・取消し待機・読取り失敗を検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { CodexWorkspaceTrust } from "../../apps/vscode-nerita/src/extension/backends/codex/settings/CodexWorkspaceTrust";
import {
	WorkspaceTrustStore,
	trustKey,
} from "../../apps/vscode-nerita/src/extension/security/trust/WorkspaceTrustStore";
import { codexFixture, codexResponseGate } from "../support/codex";

void test("Codex の信頼は設定 API で保存・再取得し、Pi の記録とは独立する", async (t) => {
	const f = await codexFixture(t);
	delete f.state.projects[f.cwd];
	const values: (string | null)[] = [];
	f.responses.set("config/batchWrite", (message) => {
		const params = z
			.object({
				edits: z.array(
					z.object({
						keyPath: z.string(),
						value: z.enum(["trusted", "untrusted"]).nullable(),
						mergeStrategy: z.literal("replace"),
					}),
				),
				reloadUserConfig: z.literal(true),
			})
			.parse(message.params);
		assert.equal(message.params?.filePath, undefined);
		assert.equal(params.edits.length, 1);
		const edit = params.edits[0]!;
		assert.equal(
			edit.keyPath,
			`projects.${JSON.stringify(trustKey(f.cwd))}.trust_level`,
		);
		values.push(edit.value);
		if (edit.value === null) {
			delete f.state.projects[trustKey(f.cwd)];
		} else {
			f.state.projects[trustKey(f.cwd)] = { trust_level: edit.value };
		}
		return {
			status: "ok",
			version: String(values.length),
			filePath: "config.toml",
		};
	});
	const codex = new CodexWorkspaceTrust(f.extensionPath, () => {});
	const store = new WorkspaceTrustStore(
		{ read: () => undefined, write: async () => {} },
		undefined,
		codex,
	);
	await store.registerWorkspace(f.cwd, "codex");
	assert.equal(await store.trusted(f.cwd, "codex"), false);
	assert.equal((await store.listFor("codex"))[0]?.trust, "unset");
	await store.setBackendTrust(f.cwd, "trusted", "codex");
	assert.equal(await store.trusted(f.cwd, "codex"), true);
	assert.equal(await store.trusted(f.cwd, "pi"), false);
	assert.equal(
		(await new CodexWorkspaceTrust(f.extensionPath, () => {}).list())[0]
			?.trust,
		"trusted",
	);
	await store.setBackendTrust(f.cwd, "untrusted", "codex");
	assert.equal(await store.trusted(f.cwd, "codex"), false);
	await store.setBackendTrust(f.cwd, "unset", "codex");
	assert.deepEqual(values, ["trusted", "untrusted", null]);
	assert.equal(await store.trusted(f.cwd, "codex"), false);
	assert.equal(
		f.requests.some((request) => request.method === "thread/start"),
		false,
	);
});

void test("Windows の表記違いを隠さず取得し、変更は小文字キーへ集約して別項目を維持する", async (t) => {
	const f = await codexFixture(t);
	const lower = trustKey(f.cwd);
	const upper = f.cwd.toUpperCase();
	const other = `${f.cwd}-other`;
	delete f.state.projects[f.cwd];
	f.state.projects[lower] = { trust_level: "untrusted" };
	f.state.projects[upper] = { trust_level: "trusted" };
	f.state.projects[other] = { trust_level: "trusted" };
	f.responses.set("config/batchWrite", (message) => {
		const { edits } = z
			.object({
				edits: z.array(
					z.object({
						keyPath: z.string(),
						value: z.enum(["trusted", "untrusted"]).nullable(),
					}),
				),
			})
			.parse(message.params);
		for (const edit of edits) {
			const path = z
				.string()
				.parse(JSON.parse(edit.keyPath.slice(9, -12)));
			if (edit.value === null) {
				delete f.state.projects[path];
			} else {
				f.state.projects[path] = { trust_level: edit.value };
			}
		}
		return { status: "ok", version: "1", filePath: "config.toml" };
	});
	const codex = new CodexWorkspaceTrust(f.extensionPath, () => {});
	assert.equal((await codex.list()).length, 3);
	assert.equal(await codex.trusted(f.cwd), false);
	await codex.change(upper, "trusted");
	assert.deepEqual(f.state.projects, {
		[lower]: { trust_level: "trusted" },
		[other]: { trust_level: "trusted" },
	});
	assert.equal(await codex.trusted(f.cwd), true);
	await codex.change(upper, "untrusted");
	assert.equal(f.state.projects[other].trust_level, "trusted");
	assert.equal(await codex.trusted(f.cwd), false);
});

void test("Codex の取消し保存待ちと不正な設定応答では信頼を許可しない", async (t) => {
	const f = await codexFixture(t);
	const codex = new CodexWorkspaceTrust(f.extensionPath, () => {});
	assert.equal(await codex.trusted(f.cwd), true);
	const gate = codexResponseGate();
	f.responses.set("config/batchWrite", () => gate.response);
	const revoke = codex.change(f.cwd, "untrusted");
	assert.equal(await codex.trusted(f.cwd), false);
	f.state.projects[f.cwd] = { trust_level: "untrusted" };
	gate.release({ status: "ok", version: "2", filePath: "config.toml" });
	await revoke;
	assert.equal(await codex.trusted(f.cwd), false);
	f.responses.set("config/read", () => ({
		config: { projects: { [f.cwd]: { trust_level: true } } },
	}));
	assert.equal(await codex.trusted(f.cwd), false);
	f.responses.delete("config/read");
	f.state.projects[f.cwd] = { trust_level: "trusted" };
	f.responses.set("config/batchWrite", () => ({
		status: "okOverridden",
		version: "3",
		filePath: "config.toml",
	}));
	await assert.rejects(codex.change(f.cwd, "untrusted"));
	assert.equal(await codex.trusted(f.cwd), false);
	f.responses.set("config/batchWrite", () => ({
		status: "ok",
		version: "4",
		filePath: "config.toml",
	}));
	await codex.change(f.cwd, "trusted");
	assert.equal(await codex.trusted(f.cwd), true);
});

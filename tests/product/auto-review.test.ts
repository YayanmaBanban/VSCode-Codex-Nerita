// 自動レビューの許可・拒否・省略・取消しを、製品の承認境界で検証する。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultAutoReview } from "@nerita/shared/agentManager/autoReview";
import { defaultGuardrails } from "@nerita/shared/guardrails/config";
import type { AutoReviewRecord } from "@nerita/shared/guardrails/review";
import { guardrailRegistry } from "../../apps/vscode-nerita/src/extension/security/GuardrailRegistry";
import { AutoReviewStore } from "../../apps/vscode-nerita/src/extension/security/AutoReviewStore";
import { bindAutoReviewContext } from "../../apps/vscode-nerita/src/extension/security/AutoReviewContext";
import { approveToolCall } from "../../apps/vscode-nerita/src/extension/security/ApprovalGuard";
import {
	consumeApprovedToolCall,
	type ToolCall,
} from "../../apps/vscode-nerita/src/extension/security/ApprovedToolCall";
import { bindTrustContext } from "../../apps/vscode-nerita/src/extension/security/trust/TrustGate";
import { WorkspaceTrustStore } from "../../apps/vscode-nerita/src/extension/security/trust/WorkspaceTrustStore";
import { createWorkspaceAccessPolicy } from "../../apps/vscode-nerita/src/extension/security/WorkspacePathPolicy";
import { verifyReviewFiles } from "../../apps/vscode-nerita/src/extension/security/AutoReviewPolicy";
import { until } from "../support/pi";

const allowed = {
	outcome: "allow",
	risk: "low",
	authorization: "high",
	reason: "指定の操作",
};

/** モデル通信だけを差し替え、信頼と許可の発行は製品コードを使う。 */
async function fixture(t: TestContext) {
	const root = await mkdtemp(
		join(process.env.NERITA_TEST_ROOT!, "auto-review-"),
	);
	const trust = new WorkspaceTrustStore({
		read: () => undefined,
		write: async () => {},
	});
	await trust.setUserTrust(root, true);
	const binding = bindTrustContext(trust, [root], () => true);
	t.after(binding.dispose);
	const store = new AutoReviewStore();
	await store.save(root, {
		...defaultAutoReview(),
		mode: "auto",
		model: "local/reviewer",
	});
	let requests = 0;
	let manual = 0;
	let input = "";
	const records: AutoReviewRecord[] = [];
	let review: () => Promise<unknown> = () => Promise.resolve(allowed);
	const detach = bindAutoReviewContext(binding.id, {
		root,
		evidence: () => [{ role: "user", text: "指定の操作を実施" }],
		protect: (text) => text,
		publish: (record) => {
			records.push(record);
		},
		review: (_config, text) => {
			requests++;
			input = text;
			return review();
		},
	});
	t.after(detach);
	const call: ToolCall = {
		tool: "powershell",
		params: { command: "Write-Output 'review'" },
		cwd: root,
		policy: {
			...(await createWorkspaceAccessPolicy([root])),
			trustContextId: binding.id,
		},
	};
	const signal = new AbortController();
	return {
		records,
		root,
		call,
		store,
		signal,
		get requests() {
			return requests;
		},
		get manual() {
			return manual;
		},
		get input() {
			return input;
		},
		setReview(value: typeof review) {
			review = value;
		},
		approve: () =>
			approveToolCall(
				call,
				() => {
					manual++;
					return Promise.resolve(signal.signal);
				},
				signal.signal,
				store,
			),
	};
}

void test("モデル承認を一度限りの許可へ反映し、環境変数の値を送信しない", async (t) => {
	const f = await fixture(t);
	f.call.env = { TOKEN: "private-value" };
	f.call.params.env = { TOKEN: "private-value" };
	const permit = await f.approve();
	assert.equal(f.requests, 1);
	assert.equal(f.manual, 0);
	assert.equal(f.input.includes("private-value"), false);
	assert.equal(consumeApprovedToolCall(permit).autoReview?.outcome, "allow");
	assert.throws(() => consumeApprovedToolCall(permit));
});

void test("固定保護で拒否された操作はレビューモデルへ送らない", async (t) => {
	const f = await fixture(t);
	f.call.tool = "write";
	f.call.params = { path: ".ssh/config", content: "blocked" };
	await assert.rejects(f.approve());
	assert.equal(f.requests, 0);
	assert.equal(f.manual, 0);
});

void test("追加ルールで承認を指定した表示コマンドも省略しない", async (t) => {
	const f = await fixture(t);
	const config = defaultGuardrails();
	config.commandRules.push({
		id: "explicit-review",
		shell: "any",
		match: "contains",
		pattern: "Write-Output",
		action: "ask",
		reason: "指定された操作",
	});
	guardrailRegistry.apply(f.root, config);
	f.call.sandbox = { name: "Microsoft MXC", details: [] };
	await f.approve();
	assert.equal(f.requests, 1);
});

void test("モデルが重大なリスクを allow と返しても Host は拒否する", async (t) => {
	const f = await fixture(t);
	f.setReview(() => Promise.resolve({ ...allowed, risk: "critical" }));
	await assert.rejects(f.approve());
	assert.equal(f.manual, 0);
});

for (const outcome of ["deny", "ask", "invalid"] as const) {
	void test(`レビュー結果 ${outcome} を自動許可へ変えない`, async (t) => {
		const f = await fixture(t);
		f.setReview(() =>
			Promise.resolve(
				outcome === "invalid"
					? "invalid-json"
					: { ...allowed, outcome },
			),
		);
		if (outcome === "deny") {
			await assert.rejects(f.approve());
		} else {
			await f.approve();
		}
		assert.equal(f.manual, outcome === "deny" ? 0 : 1);
		assert.equal(
			f.records.at(-1)?.status,
			{ deny: "denied", ask: "manual", invalid: "unavailable" }[outcome],
		);
	});
}

for (const action of ["stop", "settings"] as const) {
	void test(`${action} の後に遅いモデル承認を採用しない`, async (t) => {
		const f = await fixture(t);
		f.setReview(pendingReview);
		const pending = f.approve();
		const rejected = assert.rejects(pending);
		await until(() => f.requests === 1);
		if (action === "stop") {
			f.signal.abort();
		} else {
			await f.store.save(f.root, defaultAutoReview());
		}
		await rejected;
		assert.equal(f.manual, 0);
	});
}

void test("時間切れは手動承認へ戻し、後から許可しない", async (t) => {
	const f = await fixture(t);
	await f.store.save(f.root, {
		...defaultAutoReview(),
		mode: "auto",
		model: "local/reviewer",
		timeoutMs: 1000,
	});
	f.setReview(pendingReview);
	await Promise.all([f.approve(), setTimeout(1100)]);
	assert.equal(f.manual, 1);
	assert.equal(f.records.at(-1)?.status, "timedOut");
});

void test("表示専用バッチはモデルを省略し、内容を差し替えると実行できない", async (t) => {
	const f = await fixture(t);
	const path = join(f.root, "hello.bat");
	await writeFile(path, "@echo off\r\necho HelloWorld\r\n");
	f.call.params = { command: ".\\hello.bat" };
	f.call.sandbox = { name: "Microsoft MXC", details: [] };
	const permit = await f.approve();
	assert.equal(f.requests, 0);
	assert.equal(f.manual, 0);
	assert.equal(permit.call.reviewFiles?.length, 1);
	await verifyReviewFiles(permit.call);
	await writeFile(path, "del important.txt");
	await assert.rejects(verifyReviewFiles(permit.call));
});

void test("バッチの展開とコマンド連結は直接実行せず審査へ送る", async (t) => {
	const f = await fixture(t);
	await writeFile(join(f.root, "unsafe.bat"), "echo %SECRET% > exported.txt");
	f.call.params = { command: ".\\unsafe.bat" };
	f.call.sandbox = { name: "Microsoft MXC", details: [] };
	await f.approve();
	assert.equal(f.requests, 1);
});

void test("保存の再読込で設定を復元し、保存失敗では旧設定を維持する", async () => {
	let saved: unknown;
	const storage = {
		get: () => saved,
		update: (_key: string, value: unknown) => {
			saved = value;
			return Promise.resolve();
		},
	};
	const store = new AutoReviewStore();
	store.connect(storage);
	const config = {
		...defaultAutoReview(),
		mode: "auto" as const,
		model: "local/reviewer",
	};
	await store.save(process.cwd(), config);
	const restored = new AutoReviewStore();
	restored.connect(storage);
	assert.deepEqual(restored.snapshot(process.cwd()).config, config);
	const previous = restored.snapshot(process.cwd());
	storage.update = () => Promise.reject(new Error("storage failed"));
	await assert.rejects(restored.save(process.cwd(), defaultAutoReview()));
	assert.equal(previous.signal.aborted, false);
	assert.deepEqual(restored.snapshot(process.cwd()).config, config);
});

/** 外部サービスが中断を無視して応答しない状態を再現する。 */
function pendingReview(): Promise<unknown> {
	return new Promise(() => {});
}

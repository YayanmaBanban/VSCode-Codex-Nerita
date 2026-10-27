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
import {
	approveToolCall,
	prefetchToolReview,
} from "../../apps/vscode-nerita/src/extension/security/ApprovalGuard";
import {
	consumeApprovedToolCall,
	type ToolCall,
} from "../../apps/vscode-nerita/src/extension/security/ApprovedToolCall";
import { bindTrustContext } from "../../apps/vscode-nerita/src/extension/security/trust/TrustGate";
import { WorkspaceTrustStore } from "../../apps/vscode-nerita/src/extension/security/trust/WorkspaceTrustStore";
import {
	createWorkspaceAccessPolicy,
	WorkspacePathPolicy,
} from "../../apps/vscode-nerita/src/extension/security/WorkspacePathPolicy";
import { snapshotFile } from "../../apps/vscode-nerita/src/extension/security/FileSnapshot";
import { verifyReviewFiles } from "../../apps/vscode-nerita/src/extension/security/AutoReviewPolicy";
import { until } from "../support/pi";

const allowed = {
	outcome: "allow",
	risk: "low",
	authorization: "high",
	reason: "指定の操作",
};

/** 利用者の信頼設定を使わず、独立した実ファイルの作業領域を作る。 */
async function trustedRoot(t: TestContext) {
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
	return { root, trust, binding };
}

/** モデル通信だけを差し替え、信頼と許可の発行は製品コードを使う。 */
async function fixture(t: TestContext) {
	const { root, trust, binding } = await trustedRoot(t);
	const store = new AutoReviewStore();
	await store.save(root, {
		...defaultAutoReview(),
		mode: "auto",
		model: "local/reviewer",
	});
	let requests = 0;
	let manual = 0;
	let input = "";
	let userText = "指定の操作を実施";
	const records: AutoReviewRecord[] = [];
	let review: () => Promise<unknown> = () => Promise.resolve(allowed);
	const detach = bindAutoReviewContext(binding.id, {
		root,
		evidence: () => [{ role: "user", text: userText }],
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
	t.after(detach.dispose);
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
		trust,
		invalidate: detach.invalidate,
		setUserText: (value: string) => {
			userText = value;
		},
		prefetch: () => prefetchToolReview(call, signal.signal, store),
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
		approve: (waiterSignal = signal.signal) =>
			approveToolCall(
				call,
				() => {
					manual++;
					return Promise.resolve(signal.signal);
				},
				waiterSignal,
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

/** モデル審査の対象となる設定ファイルを実ファイルとして用意する。 */
async function fileFixture(t: TestContext) {
	const f = await fixture(t);
	await writeFile(join(f.root, "package.json"), "{}");
	const paths = new WorkspacePathPolicy(f.call.policy, f.root);
	f.call.tool = "write";
	f.call.file = await snapshotFile(paths, "package.json");
	f.call.params = { path: f.call.file.path, content: '{"private":true}' };
	return { ...f, paths, original: f };
}

void test("進行中の同一ファイル審査を共有し、実行許可はそれぞれ一度だけ使える", async (t) => {
	const { original: f } = await fileFixture(t);
	let finish = (_value: unknown) => {};
	const pending = new Promise((resolve) => {
		finish = resolve;
	});
	f.setReview(() => pending);
	const first = f.approve();
	const second = f.approve();
	await until(() => f.records.length === 2);
	assert.equal(f.requests, 1);
	finish(allowed);
	const permits = await Promise.all([first, second]);
	for (const permit of permits) {
		assert.equal(
			consumeApprovedToolCall(permit).autoReview?.outcome,
			"allow",
		);
		assert.throws(() => consumeApprovedToolCall(permit));
	}
	assert.equal(f.records.at(-1)?.source, "shared");
	assert.equal(f.records.at(-1)?.metrics?.modelCalls, 1);
});

void test("共有審査を待つ1件の要求が中断しても、他の待機者の承認は取り消さない", async (t) => {
	const { original: f } = await fileFixture(t);
	let finish = (_value: unknown) => {};
	const pending = new Promise((resolve) => {
		finish = resolve;
	});
	f.setReview(() => pending);
	const abort = new AbortController();
	const first = f.approve(abort.signal);
	const rejected = assert.rejects(first);
	const second = f.approve();
	await until(() => f.records.length === 2);
	abort.abort();
	await rejected;
	finish(allowed);
	assert.equal(
		consumeApprovedToolCall(await second).autoReview?.outcome,
		"allow",
	);
	assert.equal(f.requests, 1);
});

void test("先読みは許可を発行せず、実行時と次の同一要求で low/allow を再利用する", async (t) => {
	const { original: f } = await fileFixture(t);
	await f.prefetch();
	assert.equal(f.manual, 0);
	const source = f.records.at(-1)?.id;
	consumeApprovedToolCall(await f.approve());
	assert.equal(f.records.at(-1)?.source, "prefetch");
	assert.equal(f.records.at(-1)?.reusedFrom, source);
	consumeApprovedToolCall(await f.approve());
	assert.equal(f.records.at(-1)?.source, "cache");
	assert.equal(f.requests, 1);
});

for (const outcome of ["deny", "ask"] as const) {
	void test(`先読みの ${outcome} は一度だけ引き渡し、継続的な再利用はしない`, async (t) => {
		const { original: f } = await fileFixture(t);
		f.setReview(() => Promise.resolve({ ...allowed, outcome }));
		if (outcome === "deny") {
			await assert.rejects(f.prefetch());
			await assert.rejects(f.approve());
		} else {
			await f.prefetch();
			await f.approve();
		}
		assert.equal(f.requests, 1);
		assert.equal(f.records.at(-1)?.source, "prefetch");
		if (outcome === "deny") {
			await assert.rejects(f.approve());
		} else {
			await f.approve();
		}
		assert.equal(f.requests, 2);
		assert.equal(f.manual, outcome === "deny" ? 0 : 2);
	});
}

for (const change of [
	"input",
	"file",
	"evidence",
	"policy",
	"environment",
	"settings",
	"guardrails",
	"trust",
	"stop",
] as const) {
	void test(`${change} が変わった場合は同じファイル操作も再審査する`, async (t) => {
		const { original: f, paths } = await fileFixture(t);
		await f.approve();
		switch (change) {
			case "input":
				f.call.params.content = "changed";
				break;
			case "file":
				await writeFile(
					join(f.root, "package.json"),
					'{"version":"2"}',
				);
				f.call.file = await snapshotFile(paths, "package.json");
				break;
			case "evidence":
				f.setUserText("設定の上書きを取り消す");
				break;
			case "policy":
				f.call.policy = { ...f.call.policy, networkAccess: true };
				break;
			case "environment":
				f.call.env = { TOKEN: "different-value" };
				break;
			case "settings":
				await f.store.save(f.root, f.store.snapshot(f.root).config);
				break;
			case "guardrails":
				guardrailRegistry.apply(f.root, defaultGuardrails());
				break;
			case "trust":
				await f.trust.setUserTrust(f.root, false);
				await f.trust.setUserTrust(f.root, true);
				break;
			case "stop":
				f.invalidate();
				break;
		}
		await f.approve();
		assert.equal(f.requests, 2);
		const record = f.records.at(-1);
		assert.ok(record);
		assert.equal(record.source, "model");
	});
}

void test("low より高い判定と期限切れの判定は再利用しない", async (t) => {
	const { original: f } = await fileFixture(t);
	f.setReview(() => Promise.resolve({ ...allowed, risk: "medium" }));
	await f.approve();
	await f.approve();
	assert.equal(f.requests, 2);
	f.setReview(() => Promise.resolve(allowed));
	await f.approve();
	t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
	t.mock.timers.tick(31000);
	await f.approve();
	assert.equal(f.requests, 4);
});

void test("任意のシェルは同じコマンドでも審査結果を再利用しない", async (t) => {
	const f = await fixture(t);
	await f.approve();
	await f.approve();
	assert.equal(f.requests, 2);
});

void test("すべての待機者が離れた審査の遅い allow は再利用しない", async (t) => {
	const { original: f } = await fileFixture(t);
	let finish = (_value: unknown) => {};
	const pending = new Promise((resolve) => {
		finish = resolve;
	});
	f.setReview(() => pending);
	const first = f.approve();
	const second = f.approve();
	const rejected = Promise.all([
		assert.rejects(first),
		assert.rejects(second),
	]);
	await until(() => f.records.length === 2);
	f.invalidate();
	await rejected;
	finish(allowed);
	f.setReview(() => Promise.resolve(allowed));
	consumeApprovedToolCall(await f.approve());
	assert.equal(f.requests, 2);
	assert.equal(f.manual, 0);
});

void test("会話の失効は発行済みの許可にも伝わり、新しい拒否ルールを優先する", async (t) => {
	const { original: f } = await fileFixture(t);
	const permit = await f.approve();
	f.invalidate();
	assert.throws(() => consumeApprovedToolCall(permit));
	await f.prefetch();
	const config = defaultGuardrails();
	config.pathRules.push({
		id: "deny-config",
		pattern: "package.json",
		match: "glob",
		action: "deny",
		operations: ["write"],
		exceptions: [],
		reason: "設定の変更を拒否",
	});
	guardrailRegistry.apply(f.root, config);
	await assert.rejects(f.approve());
	assert.equal(f.requests, 2);
	assert.equal(f.manual, 0);
});

void test("新しい入力は判定を再利用せず、既に起動した子ジョブの許可を維持する", async (t) => {
	const { original: f } = await fileFixture(t);
	f.call.tool = "extension:subagent";
	f.call.params = { agent: "worker", task: "依頼した作業を続ける" };
	delete f.call.file;
	const permit = await f.approve();
	consumeApprovedToolCall(permit);
	f.invalidate(false);
	assert.equal(permit.signal.aborted, false);
	await f.approve();
	assert.equal(f.requests, 2);
});

// 検出と保存を実ファイル・Git で検証し、破損や競合を初期化で隠さないことを確認する。
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	mkdir,
	writeFile,
	readFile,
	symlink,
	readdir,
	rename,
} from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { AuthorityRecordSchema } from "../../apps/vscode-nerita/src/extension/dlc/IntentAuthority";
import { detectionLimits } from "../../apps/vscode-nerita/src/extension/dlc/WorkspaceDetection";
import { applyAction, beginWork, finishWork } from "@nerita/dlc/transitions";
import {
	intentProjection,
	recoverIntent,
	IntentStateSchema,
	IntentRegistrySchema,
} from "@nerita/dlc/state";
import { migrateLegacy } from "@nerita/dlc/migration";
import { WorkspaceDetectionSchema } from "@nerita/dlc/workspace";
import { SafeDlcFiles } from "../../apps/vscode-nerita/src/extension/dlc/SafeDlcFiles";
import { IntentRepository } from "../../apps/vscode-nerita/src/extension/dlc/IntentRepository";
import { freezeKnowledge } from "../../apps/vscode-nerita/src/extension/dlc/FrozenKnowledge";
import { withDlcLock } from "../../apps/vscode-nerita/src/extension/dlc/DlcLock";
import { DlcPathSchema } from "@nerita/shared/dlc/contracts";
import { dlcWorkspace } from "../support/dlcWorkspace";
import {
	createTestIntent,
	plannedIntent,
	executionReceipt,
} from "../support/dlc";

void test("検出スキーマの公開例は有効で、未知版・機密情報・不正なプロジェクト参照を拒否する", async () => {
	const root = process.env.NERITA_TEST_REPO_ROOT;
	assert.ok(root !== undefined);
	const sample = WorkspaceDetectionSchema.parse(
		JSON.parse(
			await readFile(
				join(root, "tests/fixtures/dlc/workspace-v1.json"),
				"utf8",
			),
		),
	);
	for (const value of [
		{ ...sample, schemaVersion: 2 },
		{ ...sample, credential: "secret" },
		{ ...sample, scan: { ...sample.scan, status: "incomplete" } },
		{
			...sample,
			frameworks: [
				{
					name: "react",
					projectRoot: "missing",
					evidence: ["package.json"],
				},
			],
		},
		{
			...sample,
			projects: [
				{ root: "nested", name: "sample", manifest: "../package.json" },
			],
		},
	]) {
		assert.equal(WorkspaceDetectionSchema.safeParse(value).success, false);
	}
});

void test("初期化は決定的で、再検出しても Intent と Knowledge の内容を保持する", async (t) => {
	const f = await dlcWorkspace(t);
	const initial = await f.detection();
	assert.equal(initial.classification.detected, "greenfield");
	assert.deepEqual(initial, await f.detection());
	const intent = await f.repository.create(
		"  原文\nを維持  ",
		"同じ名前",
		initial,
	);
	const second = await f.repository.create(
		"別の目的",
		"同じ名前",
		initial,
		"bugfix",
	);
	assert.notEqual(intent.intentId, second.intentId);
	const index = IntentRegistrySchema.parse(
		JSON.parse(
			await readFile(
				join(f.root, ".nerita/dlc/spaces/default/intents/intents.json"),
				"utf8",
			),
		),
	);
	assert.notEqual(index.entries[0]?.dirName, index.entries[1]?.dirName);
	await writeFile(
		join(f.root, ".nerita/dlc/spaces/default/knowledge/practice.md"),
		"採用済みの資料",
	);
	await writeFile(
		join(f.root, ".nerita/dlc/workspace.json"),
		"破損した検出情報",
	);
	assert.deepEqual(initial, await f.detection());
	assert.equal(
		(await f.repository.load(intent.intentId)).intent.request,
		"  原文\nを維持  ",
	);
	assert.equal(
		await readFile(
			join(f.root, ".nerita/dlc/spaces/default/knowledge/practice.md"),
			"utf8",
		),
		"採用済みの資料",
	);
});
void test("pnpm の包含・除外と各プロジェクトの依存を分離し、宣言されたスクリプトだけを記録する", async (t) => {
	const f = await dlcWorkspace(t);
	await mkdir(join(f.root, "apps/web"), { recursive: true });
	await mkdir(join(f.root, "apps/excluded"), { recursive: true });
	await writeFile(
		join(f.root, "pnpm-workspace.yaml"),
		"packages:\n  - apps/*\n  - '!apps/excluded'\n",
	);
	await writeFile(
		join(f.root, "package.json"),
		JSON.stringify({
			name: "root",
			scripts: { dangerous: "must never run" },
			devDependencies: { typescript: "1" },
		}),
	);
	await writeFile(
		join(f.root, "apps/web/package.json"),
		JSON.stringify({
			name: "web",
			dependencies: { react: "1" },
			scripts: { start: "must never run" },
		}),
	);
	await writeFile(
		join(f.root, "apps/excluded/package.json"),
		"invalid JSON is excluded",
	);
	await writeFile(
		join(f.root, "apps/web/index.tsx"),
		"source is not interpreted",
	);
	const value = await f.detection();
	assert.equal(value.classification.detected, "brownfield");
	assert.equal(value.layout.kind, "monorepo");
	assert.deepEqual(
		value.projects.map((item) => item.root),
		[".", "apps/web"],
	);
	assert.deepEqual(
		value.frameworks.map((item) => [item.name, item.projectRoot]),
		[["react", "apps/web"]],
	);
	assert.deepEqual(
		value.declaredScripts.map((item) => item.names),
		[["dangerous"], ["start"]],
	);
	assert.ok(!JSON.stringify(value).includes("must never run"));
	assert.deepEqual(value, await f.detection());
});
void test("マニフェストの破損・非 Git・リンク・越境を部分成功として保存しない", async (t) => {
	const f = await dlcWorkspace(t);
	await f.detection();
	const saved = await readFile(
		join(f.root, ".nerita/dlc/workspace.json"),
		"utf8",
	);
	await rename(join(f.root, ".git"), join(f.root, ".git-hidden"));
	await assert.rejects(f.detection(), /git|Git/);
	await rename(join(f.root, ".git-hidden"), join(f.root, ".git"));
	await writeFile(join(f.root, "package.json"), "{");
	await assert.rejects(f.detection(), SyntaxError);
	assert.equal(
		await readFile(join(f.root, ".nerita/dlc/workspace.json"), "utf8"),
		saved,
	);
	for (const path of [
		"../escape",
		"a/../b",
		"C:/secret",
		"nul.json",
		"a.",
		"x\0y",
		"x\\y",
	]) {
		assert.equal(DlcPathSchema.safeParse(path).success, false);
	}
	await symlink(join(f.root, ".git"), join(f.root, "linked"), "junction");
	await assert.rejects(f.files.path("linked/config"), /リンク/);
});
void test("CAS とロックは別ウィンドウの古い更新と同時保存を拒否し、旧ファイルを保持する", async (t) => {
	const f = await dlcWorkspace(t);
	const state = await f.repository.create(
		"目的",
		"Intent",
		await f.detection(),
	);
	const other = new IntentRepository(f.files, f.authority);
	const stale = await other.load(state.intentId);
	const next = applyAction(state, {
		type: "plan",
		tasks: [
			{ title: "作業", instructions: "作業する", paths: ["hello.txt"] },
		],
	});
	await f.repository.save(next, state.revision);
	await assert.rejects(
		other.save({ ...stale, revision: stale.revision + 1 }, stale.revision),
		/競合/,
	);
	await withDlcLock(f.files, async () => {
		await assert.rejects(other.list(), /別のウィンドウ/);
	});
	assert.deepEqual(await other.load(state.intentId), next);
});
void test("Host の確定後に state の置換が失敗しても、操作 ID と監査根拠から再開する", async (t) => {
	const f = await dlcWorkspace(t);
	const state = await f.repository.create(
		"目的",
		"Intent",
		await f.detection(),
	);
	let failed = false;
	class FaultFiles extends SafeDlcFiles {
		override write(path: string, value: unknown): Promise<void> {
			if (!failed && path.endsWith("/state.json")) {
				failed = true;
				return Promise.reject(new Error("置換の中断"));
			}
			return super.write(path, value);
		}
	}
	const repository = new IntentRepository(
		new FaultFiles(f.root, () => Promise.resolve()),
		f.authority,
	);
	const next = applyAction(state, { type: "archive" });
	await assert.rejects(repository.save(next, state.revision), /置換の中断/);
	assert.deepEqual(await f.repository.load(state.intentId), next);
});
void test("登録途中の Intent は自動採用せず、信頼済み記録を確認した明示的復旧だけで登録する", async (t) => {
	const f = await dlcWorkspace(t);
	const detection = await f.detection();
	await f.repository.list();
	f.failRegistry();
	await assert.rejects(
		f.repository.create("目的", "孤立した Intent", detection),
		/索引保存の中断/,
	);
	await assert.rejects(f.repository.list(), /未登録/);
	await f.repository.recoverOrphans();
	assert.equal((await f.repository.list())[0]?.request, "目的");
});
void test("形が正しい未承認の編集・本文変更・未知スキーマを読み捨てない", async (t) => {
	const f = await dlcWorkspace(t);
	const state = await f.repository.create(
		"目的",
		"Intent",
		await f.detection(),
	);
	const directory = await f.repository.directory(state.intentId);
	const path = join(f.root, directory, "state.json");
	const changed = {
		...state,
		workflow: { ...state.workflow, status: "archived" },
	};
	await writeFile(path, JSON.stringify(changed));
	await assert.rejects(f.repository.load(state.intentId), /安全に復旧/);
	assert.equal(await readFile(path, "utf8"), JSON.stringify(changed));
	await writeFile(path, "{");
	await assert.rejects(f.repository.load(state.intentId), SyntaxError);
	assert.equal(await readFile(path, "utf8"), "{");
	assert.equal(
		IntentStateSchema.safeParse({ ...state, schemaVersion: 99 }).success,
		false,
	);
});
void test("Knowledge は実行開始時の本文・参照・ハッシュを固定し、進行状態と分ける", async (t) => {
	const f = await dlcWorkspace(t);
	const state = await f.repository.create(
		"目的",
		"Intent",
		await f.detection(),
	);
	const directory = await f.repository.directory(state.intentId);
	const path = join(f.root, ".nerita/dlc/spaces/default/knowledge/rule.md");
	await writeFile(path, "実行前の資料");
	const frozen = await freezeKnowledge(
		f.files,
		directory,
		new AbortController().signal,
	);
	await writeFile(path, "実行中に変更した資料");
	const updated = await freezeKnowledge(
		f.files,
		directory,
		new AbortController().signal,
	);
	assert.equal(frozen.entries[0]?.text, "実行前の資料");
	await writeFile(
		join(f.root, directory, "artifacts/learning-candidate.md"),
		"未採用の学習候補",
	);
	assert.equal(
		(
			await freezeKnowledge(
				f.files,
				directory,
				new AbortController().signal,
			)
		).entries.some((entry) => entry.text === "未採用の学習候補"),
		false,
	);
	assert.notEqual(frozen.digest, updated.digest);
	assert.deepEqual(
		(await f.repository.load(state.intentId)).workflow,
		state.workflow,
	);
});
void test("検出の上限と秘密情報の除外を固定し、検出失敗で保存済みの結果を置き換えない", async (t) => {
	const f = await dlcWorkspace(t);
	assert.deepEqual(detectionLimits, {
		files: 10000,
		depth: 12,
		bytes: 8388608,
		durationMs: 30000,
	});
	const initial = await f.detection();
	await writeFile(join(f.root, ".env"), "TEST_SECRET_DO_NOT_READ=fake-only");
	await mkdir(join(f.root, "node_modules"));
	await writeFile(
		join(f.root, "node_modules/package.json"),
		"invalid secret input",
	);
	assert.deepEqual(await f.detection(), initial);
	const saved = await readFile(
		join(f.root, ".nerita/dlc/workspace.json"),
		"utf8",
	);
	await mkdir(
		join(f.root, Array.from({ length: 13 }, () => "nested").join("/")),
		{ recursive: true },
	);
	await assert.rejects(f.detection(), /走査上限/);
	assert.equal(
		await readFile(join(f.root, ".nerita/dlc/workspace.json"), "utf8"),
		saved,
	);
});
void test("再検出で分類は変わっても、Intent に確定したプロファイルとユーザー判断は変わらない", async (t) => {
	const f = await dlcWorkspace(t);
	const initial = await f.detection();
	const state = await f.repository.create(
		"新規として扱う",
		"判断",
		initial,
		"classic",
		{},
		"greenfield",
	);
	await writeFile(join(f.root, "index.ts"), "export const existing = true;");
	const updated = await f.detection();
	assert.equal(updated.classification.detected, "brownfield");
	assert.notEqual(
		updated.scan.inputFingerprint,
		initial.scan.inputFingerprint,
	);
	assert.deepEqual(
		(await f.repository.load(state.intentId)).routing,
		state.routing,
	);
	assert.equal(state.routing.projectTypeSource, "user");
	await assert.rejects(
		f.repository.create("目的", "古い検出", initial),
		/再検出/,
	);
});
void test("未実装の工程は、形が正しい成功・承認待ち・修正中への直接更新も保存しない", async (t) => {
	const f = await dlcWorkspace(t);
	await writeFile(join(f.root, "index.ts"), "existing code");
	const state = await f.repository.create(
		"目的",
		"工程",
		await f.detection(),
	);
	for (const status of [
		"completed",
		"awaiting-approval",
		"revising",
	] as const) {
		const changed = structuredClone(state);
		changed.revision++;
		changed.workflow.stages.find((stage) => stage.id === "2.1")!.status =
			status;
		await assert.rejects(
			f.repository.save(changed, state.revision),
			/未実装/,
		);
	}
	assert.deepEqual(await f.repository.load(state.intentId), state);
});
void test("Goal 移行は ID・原文・実行記録を保持し、レビュー待ちを正式な工程完了へ変換しない", () => {
	const complete = finishWork(
		beginWork(plannedIntent(), "attempt"),
		"attempt",
		executionReceipt(),
	);
	const workItems = complete.workItems.map((item) => ({
		...item,
		attempts: legacyAttempts(item.attempts),
	}));
	const legacy = {
		schemaVersion: 1,
		id: complete.intentId,
		goal: "  原文  ",
		revision: 8,
		stage: "awaiting-review",
		workItems,
	};
	const migrated = migrateLegacy(
		legacy,
		complete.routing,
		complete.intent.createdAt,
	);
	assert.equal(migrated.intentId, legacy.id);
	assert.equal(migrated.intent.request, legacy.goal);
	assert.deepEqual(migrated.workItems, complete.workItems);
	assert.equal(intentProjection(migrated).stage, "awaiting-review");
	assert.equal(migrated.workflow.status, "in-flight");
	assert.deepEqual(recoverIntent(migrated), migrated);
	assert.throws(() =>
		migrateLegacy(
			{ ...legacy, id: "duplicate-or-invalid" },
			createTestIntent().routing,
			complete.intent.createdAt,
		),
	);
});
function legacyAttempts(
	attempts: ReturnType<
		typeof createTestIntent
	>["workItems"][number]["attempts"],
) {
	return attempts.map((attempt) => ({ ...attempt, status: "implemented" }));
}
void test("信頼失効中の保存失敗でも、自分の保存ロックだけを解放する", async (t) => {
	const f = await dlcWorkspace(t);
	let trusted = true;
	const files = new SafeDlcFiles(f.root, () =>
		trusted ? Promise.resolve() : Promise.reject(new Error("信頼失効")),
	);
	await assert.rejects(
		withDlcLock(files, async () => {
			trusted = false;
			await files.read("unavailable");
		}),
		/信頼失効/,
	);
	assert.ok(!(await readdir(join(f.root, ".nerita/dlc"))).includes(".lock"));
});
void test("別の Host が生存している実行を中断へ変換せず、担当終了後だけ復旧を許す", async (t) => {
	const f = await dlcWorkspace(t);
	const initial = await f.repository.create(
		"目的",
		"実行担当",
		await f.detection(),
	);
	const planned = applyAction(initial, {
		type: "plan",
		tasks: [
			{ title: "作業", instructions: "更新する", paths: ["hello.txt"] },
		],
	});
	await f.repository.save(planned, initial.revision);
	const running = beginWork(planned, "attempt");
	await f.repository.save(running, planned.revision);
	const key = [...f.records.keys()].find((key) =>
		key.endsWith(`.${initial.intentId}`),
	);
	assert.ok(key !== undefined);
	const anchor = AuthorityRecordSchema.parse(f.records.get(key));
	const child = spawn(
		process.execPath,
		["-e", "setInterval(() => {}, 1000)"],
		{ windowsHide: true, stdio: "ignore" },
	);
	t.after(() => {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill();
		}
	});
	await once(child, "spawn");
	assert.ok(child.pid !== undefined);
	await f.authority.write(key, { ...anchor, ownerProcessId: child.pid });
	assert.throws(
		() => f.repository.assertResumable(running),
		/別のウィンドウ/,
	);
	assert.deepEqual(await f.repository.load(initial.intentId), running);
	const exited = once(child, "exit");
	child.kill();
	await exited;
	assert.doesNotThrow(() => f.repository.assertResumable(running));
	const recovered = recoverIntent(running);
	await f.repository.save(recovered, running.revision);
	assert.equal(
		(await f.repository.load(initial.intentId)).workItems[0]?.status,
		"interrupted",
	);
});

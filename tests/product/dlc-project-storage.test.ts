// Git で作成した Worktree と Host の保存処理を使い、状態の一元化と履歴のコピーからの誤復旧を検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, realpath, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dlcWorkspace } from "../support/dlcWorkspace";
import {
	ProjectStorage,
	projectIdentity,
} from "../../apps/vscode-nerita/src/extension/dlc/ProjectStorage";
import { IntentRepository } from "../../apps/vscode-nerita/src/extension/dlc/IntentRepository";
import { StateDiskSchema } from "../../apps/vscode-nerita/src/extension/dlc/IntentPersistence";
import { sessionOwnershipStorage } from "../../apps/vscode-nerita/src/extension/dlc/SessionOwnershipStorage";
import { BackendRuntime } from "../../apps/vscode-nerita/src/extension/session/BackendRuntime";
import { piFixture } from "../support/pi";
import { withDlcLock } from "../../apps/vscode-nerita/src/extension/dlc/DlcLock";
import { hostFiles } from "../../apps/vscode-nerita/src/extension/dlc/HostFiles";
import { setTimeout } from "node:timers/promises";

const execute = promisify(execFile);

void test("別プロファイルで開始した DLC の会話も手動で再開せず、所有者の保存を併合する", async (t) => {
	const f = await piFixture(t);
	const host = join(f.root, "host");
	const first = await sessionOwnershipStorage(host);
	const second = await sessionOwnershipStorage(host);
	first.remember("managed-one");
	await first.flush();
	const runtime = new BackendRuntime(() => f.controller(), second);
	t.after(() => runtime.dispose());
	await assert.rejects(
		runtime.receive({
			type: "session/load",
			requestId: "old-profile",
			sessionId: "managed-one",
		}),
	);
	second.remember("managed-two");
	await second.flush();
	const reopened = await sessionOwnershipStorage(host);
	assert.equal(reopened.has("managed-one"), true);
	assert.equal(reopened.has("managed-two"), true);
	await writeFile(
		join(host, "session-ownership/.nerita/dlc/sessions.json"),
		"{broken}",
	);
	await assert.rejects(
		runtime.receive({
			type: "session/load",
			requestId: "broken-owner",
			sessionId: "managed-one",
		}),
	);
});

void test("共通会話保存は別ウィンドウと同時に追記しても併合し、その後も保存を継続する", async (t) => {
	const f = await piFixture(t);
	const host = join(f.root, "host");
	const first = await sessionOwnershipStorage(host);
	const second = await sessionOwnershipStorage(host);
	first.remember("one");
	second.remember("two");
	await Promise.all([first.flush(), second.flush()]);
	first.remember("three");
	second.remember("four");
	await Promise.all([first.flush(), second.flush()]);
	await second.refresh();
	await second.flush();
	const reopened = await sessionOwnershipStorage(host);
	for (const id of ["one", "two", "three", "four"]) {
		assert.equal(reopened.has(id), true, id);
	}
});

void test("保存ロックの待機期限を超えても解放後の flush で未保存 ID を回収し、真正な保存失敗では送信を拒否し続ける", async (t) => {
	const f = await piFixture(t);
	const host = join(f.root, "host");
	const ownership = await sessionOwnershipStorage(host);
	const files = await hostFiles(host, "session-ownership");
	let release!: () => void;
	let acquired!: () => void;
	const ready = new Promise<void>((resolve) => {
		acquired = resolve;
	});
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const holding = withDlcLock(files, async () => {
		acquired();
		await gate;
	});
	t.after(async () => {
		release();
		await holding;
	});
	await ready;
	ownership.remember("waiting");
	// remember の保存が先に競合失敗し、flush 自身の再試行も期限切れになる。
	await assert.rejects(ownership.flush());
	release();
	await holding;
	await ownership.refresh();
	await ownership.flush();
	ownership.remember("after-lock");
	await ownership.flush();
	const reopened = await sessionOwnershipStorage(host);
	assert.equal(reopened.has("waiting"), true);
	assert.equal(reopened.has("after-lock"), true);
	await writeFile(
		join(host, "session-ownership/.nerita/dlc/sessions.json"),
		"{broken}",
	);
	ownership.remember("broken");
	await assert.rejects(ownership.flush());
	await writeFile(
		join(host, "session-ownership/.nerita/dlc/sessions.json"),
		"[]",
	);
	ownership.remember("after-corruption");
	await ownership.refresh();
	await assert.rejects(ownership.flush());
	await setTimeout(25);
	assert.equal(
		await readFile(
			join(host, "session-ownership/.nerita/dlc/sessions.json"),
			"utf8",
		),
		"[]",
	);
});

void test("実行状態は Worktree の外へ保存し、Git に出力した状態の写しを編集しても復旧に使わない", async (t) => {
	const f = await dlcWorkspace(t);
	const storageRoot = await realpath(
		await mkdtemp(join(tmpdir(), "nerita-live-state-")),
	);
	let current: ProjectStorage | undefined;
	t.after(async () => {
		await current?.dispose();
		await rm(storageRoot, { recursive: true, force: true });
	});
	const check = () => Promise.resolve();
	const storage = await ProjectStorage.open(f.root, storageRoot, check);
	current = storage;
	const repository = new IntentRepository(
		f.files,
		storage.authority,
		storage.files,
	);
	const state = await repository.create(
		"目的",
		"外部状態",
		await f.detection(),
	);
	const directory = await repository.directory(state.intentId);
	assert.equal(await f.files.read(`${directory}/state.json`), undefined);
	await repository.exportSnapshot(state.intentId);
	const snapshot = await readFile(
		join(f.root, directory, "state.json"),
		"utf8",
	);
	assert.equal(
		StateDiskSchema.parse(JSON.parse(snapshot)).revision,
		state.revision,
	);
	await writeFile(join(f.root, directory, "state.json"), "{broken snapshot}");
	assert.deepEqual(await repository.load(state.intentId), state);
	await storage.dispose();
	current = await ProjectStorage.open(f.root, storageRoot, check);
	const reopened = new IntentRepository(
		f.files,
		current.authority,
		current.files,
	);
	assert.deepEqual(await reopened.load(state.intentId), state);
	const otherRoot = await realpath(
		await mkdtemp(join(tmpdir(), "nerita-new-host-")),
	);
	const empty = await ProjectStorage.open(f.root, otherRoot, check);
	t.after(async () => {
		await empty.dispose();
		await rm(otherRoot, { recursive: true, force: true });
	});
	assert.deepEqual(
		await new IntentRepository(
			f.files,
			empty.authority,
			empty.files,
		).list(),
		[],
	);
});

void test("main と linked worktree は同じ project を識別し、管理元の同時所有を拒否する", async (t) => {
	const f = await dlcWorkspace(t);
	await execute(
		"git",
		[
			"-C",
			f.root,
			"-c",
			"user.name=Nerita Test",
			"-c",
			"user.email=test@example.test",
			"commit",
			"--allow-empty",
			"-m",
			"initial",
		],
		{ windowsHide: true },
	);
	const parent = await realpath(
		await mkdtemp(join(tmpdir(), "nerita-worktree-owner-")),
	);
	const storage = await ProjectStorage.open(
		f.root,
		join(parent, "host"),
		() => Promise.resolve(),
	);
	t.after(async () => {
		await storage.dispose();
		await rm(parent, { recursive: true, force: true });
	});
	const linked = join(parent, "linked");
	await execute(
		"git",
		["-C", f.root, "worktree", "add", "--detach", linked, "HEAD"],
		{ windowsHide: true },
	);
	const mainId = await projectIdentity(f.root);
	assert.equal((await projectIdentity(linked)).id, mainId.id);
	await assert.rejects(
		ProjectStorage.open(linked, join(parent, "host"), () =>
			Promise.resolve(),
		),
	);
	await assert.rejects(
		ProjectStorage.open(f.root, f.root, () => Promise.resolve()),
	);
});

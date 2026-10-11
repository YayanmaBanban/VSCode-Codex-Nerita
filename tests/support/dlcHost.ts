// 実際の DLC Host・Git・Pi SDK を接続し、VS Code API とモデル通信の外部境界だけを用意する。
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";
import type { DlcAction } from "@nerita/shared/dlc/contracts";
import type { BackendId } from "@nerita/shared/backend";
import { DlcHost } from "../../apps/vscode-nerita/src/extension/dlc/DlcHost";
import { BackendRuntime } from "../../apps/vscode-nerita/src/extension/session/BackendRuntime";
import { piFixture } from "./pi";

const execute = promisify(execFile);

/** 会話・Git・保存処理を代替せず、必要な VS Code の Memento とワークスペースだけを用意する。 */
export function hostContext(
	root: string,
	backend: BackendId = "pi",
): vscode.ExtensionContext {
	Object.assign(vscode.workspace, {
		isTrusted: true,
		workspaceFolders: [{ uri: { scheme: "file", fsPath: root } }],
		getConfiguration: () => ({ get: () => backend }),
	});
	const records = new Map<string, unknown>();
	const memento = {
		get: (key: string) => records.get(key),
		update: (key: string, value: unknown) => {
			records.set(key, value);
			return Promise.resolve();
		},
	};
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
	return {
		globalState: memento,
		workspaceState: memento,
		subscriptions: [],
	} as unknown as vscode.ExtensionContext;
}

/** VS Code API のみを代替し、ユーザー共通の保存先を新しい検証領域に限定する。 */
export async function dlcHostFixture(t: TestContext) {
	const f = await piFixture(t);
	f.storage("global");
	const previousLocal = process.env.LOCALAPPDATA;
	process.env.LOCALAPPDATA = join(f.root, "local");
	t.after(() => {
		if (previousLocal === undefined) {
			delete process.env.LOCALAPPDATA;
		} else {
			process.env.LOCALAPPDATA = previousLocal;
		}
	});
	await prepareRepository(f.cwd);
	const context = hostContext(f.cwd);
	const runtime = new BackendRuntime((_backend, root) =>
		f.controller(undefined, root ?? f.cwd),
	);
	const unsubscribeTrust = f.trust.onChange((root) =>
		runtime.invalidateTrust(root),
	);
	const host = new DlcHost(context, f.trust, runtime);
	t.after(async () => {
		unsubscribeTrust();
		await host.dispose();
		await runtime.dispose();
	});
	await host.receive({
		type: "dlc/create",
		requestId: "create",
		request: "挨拶を変更する",
		title: "履歴選択",
		profile: "classic",
		projectType: "brownfield",
	});
	assert.equal(host.view().error, null);
	const intentId = host.view().selected!.intentId;
	await host.receive({ type: "dlc/read", requestId: "read" });
	const action = async (actionValue: DlcAction) => {
		await host.receive({
			type: "dlc/action",
			requestId: actionValue.type,
			intentId,
			revision: host.view().selected!.revision,
			action: actionValue,
		});
		assert.equal(host.view().error, null);
	};
	await action({
		type: "plan",
		tasks: [
			{
				title: "挨拶",
				instructions: "hello.txt を更新する",
				paths: ["hello.txt"],
			},
		],
	});
	await host.receive({
		type: "dlc/target",
		requestId: "target",
		intentId,
		revision: host.view().selected!.revision,
		targetId: host.view().targets.find((target) => target.main)!.id,
	});
	assert.equal(host.view().error, null);
	return { f, runtime, host, intentId, action };
}

/** 未コミットの製品ファイルをコピーせず、検証用の main HEAD を作る。 */
export async function prepareRepository(root: string) {
	await writeFile(join(root, "hello.txt"), "before\n");
	await execute("git", ["init", "--quiet", root], { windowsHide: true });
	await execute("git", ["-C", root, "config", "core.autocrlf", "false"], {
		windowsHide: true,
	});
	await execute("git", ["-C", root, "add", "hello.txt"], {
		windowsHide: true,
	});
	await execute(
		"git",
		[
			"-C",
			root,
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.test",
			"commit",
			"--quiet",
			"-m",
			"initial",
		],
		{ windowsHide: true },
	);
}

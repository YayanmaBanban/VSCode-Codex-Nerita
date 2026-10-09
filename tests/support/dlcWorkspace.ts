// Git とファイルの実境界を通して、検出・保存・復旧を検証するための独立した領域を作る。
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TestContext } from "node:test";
import { SafeDlcFiles } from "../../apps/vscode-nerita/src/extension/dlc/SafeDlcFiles";
import { initializeWorkspace } from "../../apps/vscode-nerita/src/extension/dlc/WorkspaceDetection";
import { IntentRepository } from "../../apps/vscode-nerita/src/extension/dlc/IntentRepository";
import type { IntentAuthority } from "../../apps/vscode-nerita/src/extension/dlc/IntentAuthority";

export async function dlcWorkspace(t: TestContext) {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), "nerita-dlc-workspace-")),
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	await promisify(execFile)("git", ["init", root], { windowsHide: true });
	const files = new SafeDlcFiles(root, () => Promise.resolve());
	const records = new Map<string, unknown>();
	let failRegistry = false;
	const authority: IntentAuthority = {
		read: (key) => records.get(key),
		write: (key, value) => {
			if (failRegistry && key.endsWith(".registry")) {
				failRegistry = false;
				return Promise.reject(new Error("索引保存の中断"));
			}
			records.set(key, value);
			return Promise.resolve();
		},
	};
	const detection = () =>
		initializeWorkspace(files, new AbortController().signal);
	const repository = new IntentRepository(files, authority);
	return {
		root,
		files,
		records,
		authority,
		repository,
		detection,
		failRegistry: () => {
			failRegistry = true;
		},
	};
}

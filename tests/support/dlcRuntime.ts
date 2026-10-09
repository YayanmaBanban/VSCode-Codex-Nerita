// 実際の管理ファイルと共通 Runtime を使い、外部プロバイダー境界だけを差し替える。
import type { TestContext } from "node:test";
import type { Permission } from "@nerita/shared/chatState";
import type { BackendSession } from "../../apps/vscode-nerita/src/extension/session/chatSession";
import type { BackendId } from "@nerita/shared/backend";
import { BackendRuntime } from "../../apps/vscode-nerita/src/extension/session/BackendRuntime";
import { DlcSessionOwnership } from "../../apps/vscode-nerita/src/extension/session/DlcSessionOwnership";
import { DlcRuntime } from "../../apps/vscode-nerita/src/extension/dlc/DlcRuntime";
import { IntentRepository } from "../../apps/vscode-nerita/src/extension/dlc/IntentRepository";
import { SafeDlcFiles } from "../../apps/vscode-nerita/src/extension/dlc/SafeDlcFiles";
import { initializeWorkspace } from "../../apps/vscode-nerita/src/extension/dlc/WorkspaceDetection";
import { createTestIntent, plannedIntent, testIntentId } from "./dlc";

export async function dlcRuntimeFixture(
	t: TestContext,
	cwd: string,
	createSession: () => BackendSession,
	approve?: (permission: Permission) => void,
	backendId: BackendId = "pi",
) {
	const records = new Map<string, unknown>();
	const files = new SafeDlcFiles(cwd, () => Promise.resolve());
	await initializeWorkspace(files, new AbortController().signal);
	const repository = new IntentRepository(files, {
		read: (key) => records.get(key),
		write: (key, value) => {
			records.set(key, value);
			return Promise.resolve();
		},
	});
	await repository.import(createTestIntent());
	await repository.save(plannedIntent(), 0);
	const createRuntime = () =>
		new BackendRuntime(
			createSession,
			new DlcSessionOwnership({
				read: () => records.get("managedSessions"),
				write: (ids) => {
					records.set("managedSessions", ids);
					return Promise.resolve();
				},
			}),
		);
	const backend = createRuntime();
	t.after(() => backend.dispose());
	backend.selectDlc(testIntentId);
	backend.selectMode("dlc");
	if (approve) {
		const seen = new Set<string>();
		const unsubscribe = backend.subscribe(() => {
			const state = backend.snapshot();
			for (const permission of state.permissions) {
				if (seen.has(permission.id)) {
					continue;
				}
				seen.add(permission.id);
				approve(permission);
				const option = permission.options.find(
					(option) => option.kind === "allow",
				);
				if (
					option &&
					state.sessionId !== null &&
					state.runId !== null
				) {
					void backend.receive({
						type: "permission/respond",
						requestId: permission.id,
						sessionId: state.sessionId,
						runId: state.runId,
						permissionId: permission.id,
						optionId: option.id,
					});
				}
			}
		});
		t.after(unsubscribe);
	}
	return {
		createRuntime,
		repository,
		backend,
		runtime: new DlcRuntime(repository, backend, () => backendId),
	};
}

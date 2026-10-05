// 実際の信頼記録と会話ルートを使い、チャット通知の更新と通信契約を検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";
import { initialState } from "@nerita/shared/chatState";
import type { HostMessage } from "@nerita/shared/messages";
import { isHostMessage } from "@nerita/shared/hostMessageValidation";
import { isUiMessage } from "@nerita/shared/uiMessageValidation";
import { WorkspaceTrustStore } from "../../apps/vscode-nerita/src/extension/security/trust/WorkspaceTrustStore";
import { ChatTrustState } from "../../apps/vscode-nerita/src/extension/webview/ChatTrustState";

void test("信頼の付与・取消し、会話ルートとバックエンドの変更を通知する", async () => {
	const root = join(process.env.NERITA_TEST_ROOT!, "trust-notice");
	const other = join(process.env.NERITA_TEST_ROOT!, "other-root");
	await mkdir(root);
	await mkdir(other);
	const store = new WorkspaceTrustStore({
		read: () => undefined,
		write: async () => {},
	});
	const host = prepareHost(root, store);
	try {
		await host.notices.refresh();
		assert.deepEqual(host.messages.at(-1), {
			type: "workspace/trustState",
			untrusted: true,
		});
		await store.setUserTrust(root, true);
		await host.notices.refresh();
		assert.equal(host.messages.at(-1)?.untrusted, false);
		Object.assign(vscode.workspace, { isTrusted: false });
		host.grant();
		assert.equal(host.messages.at(-1)?.untrusted, true);
		Object.assign(vscode.workspace, { isTrusted: true });
		await store.setUserTrust(root, false);
		await host.notices.refresh();
		assert.equal(host.messages.at(-1)?.untrusted, true);
		await store.setUserTrust(root, true);
		host.changeRoot(other);
		await host.notices.refresh();
		assert.equal(host.messages.at(-1)?.untrusted, true);
		host.changeBackend("codex");
		assert.equal(host.messages.at(-1)?.untrusted, false);
		assert.ok(host.messages.every(isHostMessage));
	} finally {
		host.notices.dispose();
	}
});

void test("信頼通知は真偽値だけを受け付け、管理操作には要求 ID が必要", () => {
	assert.equal(
		isHostMessage({ type: "workspace/trustState", untrusted: "false" }),
		false,
	);
	assert.equal(isUiMessage({ type: "workspace/manageTrust" }), false);
	assert.equal(
		isUiMessage({ type: "workspace/manageTrust", requestId: "trust" }),
		true,
	);
});

void test("信頼取消しの保存失敗中は全ルートを拒否し、明示的な再保存後に復旧する", async () => {
	const root = join(process.env.NERITA_TEST_ROOT!, "trust-recovery");
	const other = join(process.env.NERITA_TEST_ROOT!, "trust-recovery-other");
	await mkdir(root);
	await mkdir(other);
	let fail = false;
	const store = new WorkspaceTrustStore({
		read: () => undefined,
		write: () =>
			fail
				? Promise.reject(new Error("storage unavailable"))
				: Promise.resolve(),
	});
	await store.setUserTrust(root, true);
	await store.setUserTrust(other, true);
	fail = true;
	await assert.rejects(
		store.setUserTrust(root, false),
		/storage unavailable/,
	);
	assert.equal(await store.trusted(root), false);
	assert.equal(await store.trusted(other), false);
	fail = false;
	await store.setUserTrust(root, true);
	assert.equal(await store.trusted(root), true);
	assert.equal(await store.trusted(other), true);
});

/** VS Code の設定・イベントだけを代替し、信頼の照合は実装を通す。 */
function prepareHost(root: string, store: WorkspaceTrustStore) {
	let backend = "pi";
	let configuration!: (event: vscode.ConfigurationChangeEvent) => void;
	let grant!: () => void;
	let changeSession!: () => void;
	const state = { ...initialState(), cwd: root };
	const messages: Extract<HostMessage, { type: "workspace/trustState" }>[] =
		[];
	Object.assign(vscode.workspace, {
		isTrusted: true,
		workspaceFolders: [{ uri: { fsPath: root } }],
		getConfiguration: () => ({ get: () => backend }),
		onDidChangeConfiguration: (listener: typeof configuration) => {
			configuration = listener;
			return { dispose() {} };
		},
		onDidGrantWorkspaceTrust: (listener: typeof grant) => {
			grant = listener;
			return { dispose() {} };
		},
		onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
	});
	const notices = new ChatTrustState(
		{
			snapshot: () => state,
			subscribe: (listener) => {
				changeSession = () =>
					listener({ type: "state/snapshot", state });
				return () => {};
			},
			receive: async () => {},
		},
		store,
		(message) => {
			if (message.type === "workspace/trustState") {
				messages.push(message);
			}
		},
	);
	return {
		notices,
		messages,
		grant: () => grant(),
		changeRoot: (cwd: string) => {
			state.cwd = cwd;
			changeSession();
		},
		changeBackend: (value: string) => {
			backend = value;
			configuration({ affectsConfiguration: () => true });
		},
	};
}

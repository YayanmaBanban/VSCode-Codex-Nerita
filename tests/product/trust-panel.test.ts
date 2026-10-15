// 実際の TrustPanel とストアを接続し、確認・通知・削除を Webview の通信境界から検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";
import type { TrustReply, TrustRequest } from "@nerita/shared/workspaceTrust";
import { trustPanel } from "../../apps/vscode-nerita/src/extension/security/trust/TrustPanel";
import { WorkspaceTrustStore } from "../../apps/vscode-nerita/src/extension/security/trust/WorkspaceTrustStore";

void test("確認前には信頼を変更せず、確定・取消し・削除を1回の応答で反映する", async () => {
	const f = await fixture();
	const initial = await f.request({ type: "refresh" });
	const order = initial.records.map((record) => record.root);
	const prepared = await f.request({ type: "trust", root: f.first });
	assert.equal(await f.store.trusted(f.first), false);
	assert.equal(prepared.confirmation?.canonical, f.first);
	const rejected = await f.request({
		type: "trust",
		root: f.first,
		confirmationId: "forged",
	});
	assert.notEqual(rejected.error, null);
	assert.equal(await f.store.trusted(f.first), false);
	await f.promote(f.first);
	const both = await f.promote(f.second);
	assert.deepEqual(
		both.records.map((record) => record.root),
		order,
	);
	const revoked = await f.request({ type: "revoke", root: f.first });
	assert.equal(
		revoked.records.find((record) => record.root === f.second)?.trust,
		"trusted",
	);
	assert.equal(await f.store.trusted(f.second), true);
	const refreshed = await f.request({ type: "refresh" });
	assert.deepEqual(refreshed.records, revoked.records);
	const removed = await f.request({ type: "remove", root: f.second });
	assert.deepEqual(
		removed.records.map((record) => record.root),
		[f.first],
	);
	assert.equal(f.messages.length, f.requests.length);
	f.close();
});

void test("制限モードとキャンセル後の信頼確定を拒否する", async () => {
	const f = await fixture();
	Object.assign(vscode.workspace, { isTrusted: false });
	const restricted = await f.request({ type: "trust", root: f.first });
	assert.notEqual(restricted.error, null);
	assert.equal(restricted.confirmation, null);
	Object.assign(vscode.workspace, { isTrusted: true });
	const prepared = await f.request({ type: "trust", root: f.first });
	assert.ok(prepared.confirmation);
	await f.request({ type: "refresh" });
	const cancelled = await f.request({
		type: "trust",
		root: f.first,
		confirmationId: prepared.confirmation.id,
	});
	assert.notEqual(cancelled.error, null);
	assert.equal(await f.store.trusted(f.first), false);
	f.close();
});

/** VS Code API と Webview の配送だけを代替し、保存と確認判定は製品実装を使う。 */
async function fixture() {
	const root = join(
		process.env.NERITA_TEST_ROOT!,
		`panel-${crypto.randomUUID()}`,
	);
	const first = join(root, "a-project");
	const second = join(root, "b-project");
	await mkdir(first, { recursive: true });
	await mkdir(second);
	const store = new WorkspaceTrustStore({
		read: () => undefined,
		write: async () => {},
	});
	await store.registerWorkspace(second);
	await store.registerWorkspace(first);
	const messages: TrustReply[] = [];
	const requests: TrustRequest[] = [];
	const waiting = new Map<string, (reply: TrustReply) => void>();
	let receive: (message: unknown) => void = () => {};
	let close = () => {};
	const panel = panelBoundary(
		messages,
		waiting,
		(listener) => {
			receive = listener;
		},
		(listener) => {
			close = listener;
		},
	);
	Object.assign(vscode.window, { createWebviewPanel: () => panel });
	Object.assign(vscode.workspace, {
		isTrusted: true,
		getConfiguration: () => ({ get: () => "pi" }),
	});
	Object.assign(vscode.ViewColumn, { Active: 1 });
	Object.assign(vscode.Uri, {
		file: (fsPath: string) => ({ fsPath, toString: () => fsPath }),
		joinPath: (base: vscode.Uri, ...parts: string[]) => ({
			fsPath: join(base.fsPath, ...parts),
			toString: () => parts.join("/"),
		}),
	});
	trustPanel(
		{
			extensionUri: vscode.Uri.file(root),
			globalStorageUri: vscode.Uri.file(join(root, "storage", "nerita")),
			subscriptions: [],
		},
		store,
	)();
	/** 要求と同じ ID の応答だけを受け取り、途中通知では完了させない。 */
	const request = (message: TrustRequest): Promise<TrustReply> =>
		new Promise((resolve) => {
			const requestId = crypto.randomUUID();
			waiting.set(requestId, resolve);
			requests.push(message);
			receive({ ...message, backend: "pi", requestId });
		});
	/** Host の確認 token を変更せず返し、実際のユーザー確定を代替する。 */
	const promote = async (path: string) => {
		const prepared = await request({ type: "trust", root: path });
		assert.ok(prepared.confirmation);
		return request({
			type: "trust",
			root: path,
			confirmationId: prepared.confirmation.id,
		});
	};
	return {
		first,
		second,
		store,
		messages,
		requests,
		request,
		promote,
		close: () => close(),
	};
}

/** パネルの受信・応答・破棄を接続し、ネイティブの確認 API は提供しない。 */
function panelBoundary(
	messages: TrustReply[],
	waiting: Map<string, (reply: TrustReply) => void>,
	receive: (listener: (message: unknown) => void) => void,
	close: (listener: () => void) => void,
) {
	return {
		webview: {
			cspSource: "fixture",
			html: "",
			asWebviewUri: (uri: vscode.Uri) => uri,
			onDidReceiveMessage: (listener: (message: unknown) => void) => {
				receive(listener);
				return { dispose() {} };
			},
			postMessage: (message: TrustReply) => {
				messages.push(message);
				if (message.requestId !== undefined) {
					waiting.get(message.requestId)?.(message);
					waiting.delete(message.requestId);
				}
				return Promise.resolve(true);
			},
		},
		onDidDispose: (listener: () => void) => {
			close(listener);
		},
		reveal() {},
	};
}

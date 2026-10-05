// Webview の公開通信経路で、設定保存待ちの送信拒否と下書き保持を検証する。
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { join } from "node:path";
import * as vscode from "vscode";
import type { HostMessage, UiMessage } from "@nerita/shared/messages";
import { ChatViewProvider } from "../../apps/vscode-nerita/src/extension/webview/chatViewProvider";
import { BackendRuntime } from "../../apps/vscode-nerita/src/extension/session/BackendRuntime";
import { piFixture, until } from "../support/pi";

void test(
	"バックエンド保存待ちの送信を拒否して下書きを保持し、保存失敗後は元会話へ送信できる",
	verifyBackendPending,
);

/** SDK への送信は実処理を使い、VS Code の設定保存だけを保留する。 */
async function verifyBackendPending(t: TestContext) {
	const f = await piFixture(t);
	const settings = prepareSettings(f.cwd);
	const messages: HostMessage[] = [];
	const { controller, sessionId, receive } = await openView(t, f, messages);
	receive({
		type: "ui/saveDraft",
		requestId: "draft",
		draft: "切替中の下書き",
	});
	receive({ type: "ui/setBackend", requestId: "switch", backend: "codex" });
	await until(settings.saving);
	try {
		receive({
			type: "prompt/send",
			requestId: "during-save",
			sessionId,
			text: "切替中の下書き",
		});
		await until(() =>
			messages.some(
				(message) =>
					(message.type === "request/failed" ||
						message.type === "prompt/accepted") &&
					message.requestId === "during-save",
			),
		);
		assert.ok(
			messages.some(
				(message) =>
					message.type === "request/failed" &&
					message.requestId === "during-save",
			),
			"保存待ちの送信を受理せず下書きを維持する",
		);
		assert.equal(
			f.model.requests.length,
			0,
			"保存待ちに旧モデルへ入力を送らない",
		);
		assert.deepEqual(controller.snapshot().messages, []);
	} finally {
		settings.failSave(new Error("settings unavailable"));
	}
	await until(() =>
		messages.some(
			(message) =>
				message.type === "request/failed" &&
				message.requestId === "switch",
		),
	);
	receive({ type: "ui/ready" });
	await until(() =>
		messages.some((message) => message.type === "ui/viewState"),
	);
	assert.ok(
		messages.some(
			(message) =>
				message.type === "ui/viewState" &&
				message.draft === "切替中の下書き",
		),
	);
	f.model.replies.push("元会話での回答");
	receive({
		type: "prompt/send",
		requestId: "after-failure",
		sessionId,
		text: "切替中の下書き",
	});
	await until(
		() => controller.snapshot().run === "completed",
		() => controller.snapshot(),
	);
	assert.equal(controller.snapshot().messages.at(-1)?.text, "元会話での回答");
}

/** Pi の実接続を公開 Webview に接続し、終了時に双方を回収する。 */
async function openView(
	t: TestContext,
	f: Awaited<ReturnType<typeof piFixture>>,
	messages: HostMessage[],
) {
	const controller = f.controller();
	await controller.connect();
	const sessionId = controller.snapshot().sessionId;
	assert.ok(sessionId);
	const runtime = new BackendRuntime(() => controller);
	t.after(() => runtime.dispose());
	const extensionUri = { fsPath: f.root } as unknown as vscode.Uri;
	const provider = new ChatViewProvider(
		extensionUri,
		runtime,
		() => runtime.restart(),
		f.trust,
	);
	t.after(() => provider.dispose());
	return {
		controller,
		sessionId,
		receive: attachWebview(provider, messages),
	};
}

/** VS Code API の設定保存を保留し、製品のキャンセルや実行状態は作り替えない。 */
function prepareSettings(cwd: string) {
	let failSave!: (error: Error) => void;
	let saving = false;
	Object.assign(vscode.workspace, {
		isTrusted: true,
		workspaceFolders: [{ uri: { fsPath: cwd } }],
		getConfiguration: () => ({
			get: (key: string) => (key === "backend" ? "pi" : "secondary"),
			inspect: () => ({}),
			update: () => {
				saving = true;
				return new Promise<void>((_resolve, reject) => {
					failSave = reject;
				});
			},
		}),
		onDidChangeConfiguration: () => ({ dispose() {} }),
		onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
		onDidGrantWorkspaceTrust: () => ({ dispose() {} }),
		registerTextDocumentContentProvider: () => ({ dispose() {} }),
		onDidCloseTextDocument: () => ({ dispose() {} }),
	});
	Object.assign(vscode.languages, {
		registerDocumentPasteEditProvider: () => ({ dispose() {} }),
	});
	Object.assign(vscode.ConfigurationTarget, { Global: 1, Workspace: 2 });
	Object.assign(vscode.Uri, {
		joinPath: (base: vscode.Uri, ...parts: string[]) => ({
			fsPath: join(base.fsPath, ...parts),
			toString: () => parts.join("/"),
		}),
	});
	return {
		saving: () => saving,
		failSave: (error: Error) => failSave(error),
	};
}

/** 公開 Webview 通信の入出力を記録し、Host の検証・振り分けを通す。 */
function attachWebview(provider: ChatViewProvider, messages: HostMessage[]) {
	let receive!: (value: UiMessage) => void;
	const view = {
		webview: {
			postMessage: (message: HostMessage) => {
				messages.push(message);
				return Promise.resolve(true);
			},
			onDidReceiveMessage: (listener: typeof receive) => {
				receive = listener;
				return { dispose() {} };
			},
			asWebviewUri: (uri: vscode.Uri) => uri,
			cspSource: "fixture",
			options: {},
			html: "",
		},
		onDidDispose: () => ({ dispose() {} }),
	} as unknown as vscode.WebviewView;
	provider.resolveWebviewView(view);
	return receive;
}

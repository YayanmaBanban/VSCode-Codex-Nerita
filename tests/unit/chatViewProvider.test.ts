// VS Code境界を差し替え、複数Webviewの復元・購読・パネル再利用を検証する。
import { beforeEach, expect, it, vi } from "vitest";
import { initialState } from "../../src/shared/chatState";
import { type HostMessage } from "../../src/shared/messages";

const api = vi.hoisted(() => ({
	restartBackend: vi.fn().mockResolvedValue(undefined),
	stat: vi.fn().mockResolvedValue({ type: 1 }),
	createWebviewPanel: vi.fn(),
	executeCommand: vi.fn().mockResolvedValue(undefined),
	get: vi.fn().mockReturnValue("secondary"),
	update: vi.fn().mockResolvedValue(undefined),
	inspect: vi.fn(),
	onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: vi.fn() }),
}));
vi.mock("vscode", () => ({
	languages: {
		registerDocumentPasteEditProvider: vi.fn(() => ({ dispose: vi.fn() })),
	},
	workspace: {
		fs: { stat: api.stat },
		getConfiguration: () => ({
			get: api.get,
			update: api.update,
			inspect: api.inspect,
		}),
		onDidChangeConfiguration: api.onDidChangeConfiguration,
	},
	ConfigurationTarget: { Global: 1, Workspace: 2 },
	FileType: { File: 1, Directory: 2 },
	window: { createWebviewPanel: api.createWebviewPanel },
	commands: { executeCommand: api.executeCommand },
	ViewColumn: { Active: -1 },
	Uri: {
		parse: (uri: string) => ({
			scheme: new URL(uri).protocol.slice(0, -1),
			query: new URL(uri).search,
			fragment: new URL(uri).hash,
			toString: () => uri,
		}),
		joinPath: (_uri: unknown, ...parts: string[]) => ({
			toString: () => parts.join("/"),
		}),
	},
}));
import * as vscode from "vscode";
import { ChatViewProvider } from "../../src/extension/webview/chatViewProvider";
import { isHostMessage } from "../../src/shared/hostMessageValidation";
import { isUiMessage } from "../../src/shared/uiMessageValidation";

/** イベント解除と送信先を追跡できる最小の表示先を用意する。 */
function view() {
	let receive: ((message: unknown) => void) | undefined;
	let onDispose: (() => void) | undefined;
	const webview = {
		options: {},
		html: "",
		cspSource: "test:",
		asWebviewUri: (uri: unknown) => uri,
		postMessage: vi.fn().mockResolvedValue(true),
		onDidReceiveMessage: (listener: (message: unknown) => void) => {
			receive = listener;
			return {
				dispose: () => {
					receive = undefined;
				},
			};
		},
	};
	return {
		webview,
		reveal: vi.fn(),
		show: vi.fn(),
		onDidDispose: (listener: () => void) => {
			onDispose = listener;
			return {
				dispose: () => {
					onDispose = undefined;
				},
			};
		},
		dispose: () => onDispose?.(),
		send: async (message: unknown) => {
			receive?.(message);
			for (let i = 0; i < 30; i++) {
				await Promise.resolve();
			}
		},
	};
}
/** 同じ会話正本を共有するProviderと二つの表示先を作る。 */
function harness() {
	const state = {
		...initialState(),
		sessionId: "shared",
		sessionTitle: "現在の会話",
	};
	const listeners = new Set<(message: HostMessage) => void>();
	const session = {
		snapshot: () => structuredClone(state),
		receive: vi.fn().mockResolvedValue(undefined),
		subscribe: (listener: (message: HostMessage) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
	const sidebar = view();
	const panel = view();
	api.createWebviewPanel.mockReturnValue(panel);
	const provider = new ChatViewProvider(
		vscode.Uri.parse("file:///extension"),
		session,
		api.restartBackend,
	);
	provider.resolveWebviewView(sidebar as unknown as vscode.WebviewView);
	return { provider, sidebar, panel, session, listeners, state };
}
beforeEach(() => {
	vi.clearAllMocks();
	api.get.mockReturnValue("secondary");
	api.inspect.mockReturnValue(undefined);
	api.update.mockImplementation((_key: string, value: string) => {
		api.get.mockReturnValue(value);
		return Promise.resolve();
	});
});
it("メニューの選択識別子を検証し、本文を含めずWebviewへ通知する", () => {
	const h = harness();
	for (const context of [
		undefined,
		{},
		{ composerSelectionId: "" },
		{ composerSelectionId: 1 },
	]) {
		h.provider.convertSelectionToCodeBlock(context);
	}
	expect(h.sidebar.webview.postMessage).not.toHaveBeenCalled();
	h.provider.convertSelectionToCodeBlock({
		composerSelectionId: "selection-1",
	});
	const message = { type: "ui/codeBlock", requestId: "selection-1" };
	expect(h.sidebar.webview.postMessage).toHaveBeenCalledWith(message);
	expect(isHostMessage(message)).toBe(true);
	expect(isHostMessage({ type: "ui/codeBlock" })).toBe(false);
	h.provider.dispose();
});
it("配置をユーザー設定へ保存し、エディタの下書きをサイドバーへ復元する", async () => {
	const h = harness();
	await h.sidebar.send({ type: "ui/openEditor", requestId: "open" });
	await h.panel.send({
		type: "ui/saveDraft",
		requestId: "draft",
		draft: "入力中",
	});
	await h.panel.send({
		type: "ui/setSidebar",
		requestId: "move",
		location: "primary",
	});
	expect(api.update).toHaveBeenCalledWith("sidebarLocation", "primary", 1);
	expect(api.executeCommand).toHaveBeenCalledWith("vscode.moveViews", {
		viewIds: ["nerita.codex.chat"],
		destinationId: "workbench.view.extension.nerita-primary",
	});
	expect(h.sidebar.webview.postMessage).toHaveBeenCalledWith({
		type: "ui/sidebarState",
		location: "primary",
	});
	expect(h.sidebar.webview.postMessage).toHaveBeenLastCalledWith(
		expect.objectContaining({ draft: "入力中", restoreScroll: true }),
	);
	expect(h.listeners.size).toBe(1);
	h.provider.dispose();
});
it("保存済みプライマリを初回表示で復元し、保存失敗時は移動しない", async () => {
	api.get.mockReturnValue("primary");
	const h = harness();
	await h.sidebar.send({ type: "ui/ready" });
	expect(api.executeCommand).toHaveBeenCalledWith(
		"vscode.moveViews",
		expect.objectContaining({
			destinationId: "workbench.view.extension.nerita-primary",
		}),
	);
	api.executeCommand.mockClear();
	api.update.mockRejectedValueOnce(new Error("read only"));
	await h.sidebar.send({
		type: "ui/setSidebar",
		requestId: "failed",
		location: "secondary",
	});
	expect(api.executeCommand).not.toHaveBeenCalled();
	expect(api.restartBackend).not.toHaveBeenCalled();
	expect(h.sidebar.webview.postMessage).toHaveBeenLastCalledWith(
		expect.objectContaining({
			type: "request/failed",
			requestId: "failed",
		}),
	);
	h.provider.dispose();
});
it("配置の不正値を通信の両端で拒否する", () => {
	for (const location of [null, "left", 0, {}]) {
		expect(
			isUiMessage({ type: "ui/setSidebar", requestId: "x", location }),
		).toBe(false);
		expect(isHostMessage({ type: "ui/sidebarState", location })).toBe(
			false,
		);
	}
});
it.each([
	[undefined, 1],
	[{ globalValue: "codex" }, 1],
	[{ globalValue: "pi", workspaceValue: "codex" }, 2],
])(
	"バックエンドを既存の設定スコープへ保存してからバックエンド再起動する: %j",
	async (inspection, target) => {
		api.inspect.mockReturnValue(inspection);
		const h = harness();
		await h.sidebar.send({ type: "ui/openEditor", requestId: "open" });
		await h.sidebar.send({
			type: "ui/setBackend",
			requestId: "backend",
			backend: "pi",
		});
		expect(api.update).toHaveBeenCalledWith("backend", "pi", target);
		expect(api.restartBackend).toHaveBeenCalledTimes(1);
		expect(api.update.mock.invocationCallOrder[0]).toBeLessThan(
			api.restartBackend.mock.invocationCallOrder[0]!,
		);
		for (const view of [h.sidebar, h.panel]) {
			expect(view.webview.postMessage).toHaveBeenCalledWith({
				type: "ui/backendState",
				backend: "pi",
			});
		}
		expect(h.session.receive).not.toHaveBeenCalled();
		h.provider.dispose();
	},
);
it("実行中は設定保存とバックエンド切替を拒否する", async () => {
	const h = harness();
	h.state.run = "running";
	await h.sidebar.send({
		type: "ui/setBackend",
		requestId: "busy",
		backend: "pi",
	});
	expect(api.update).not.toHaveBeenCalled();
	expect(api.restartBackend).not.toHaveBeenCalled();
	expect(api.executeCommand).not.toHaveBeenCalled();
	expect(h.sidebar.webview.postMessage).toHaveBeenCalledWith(
		expect.objectContaining({ type: "request/failed", requestId: "busy" }),
	);
	h.provider.dispose();
});

it("切替時も下書きとパネルを保持し、ウィンドウ再読み込みを呼ばない", async () => {
	const h = harness();
	await h.sidebar.send({
		type: "ui/saveDraft",
		requestId: "draft",
		draft: "未送信",
	});
	await h.sidebar.send({ type: "ui/openEditor", requestId: "panel" });
	const html = h.panel.webview.html;
	await h.sidebar.send({
		type: "ui/setBackend",
		requestId: "switch",
		backend: "pi",
	});
	await h.panel.send({ type: "ui/ready" });
	expect(h.panel.webview.html).toBe(html);
	expect(api.createWebviewPanel).toHaveBeenCalledOnce();
	expect(api.executeCommand).not.toHaveBeenCalled();
	expect(h.panel.webview.postMessage).toHaveBeenCalledWith(
		expect.objectContaining({ type: "ui/viewState", draft: "未送信" }),
	);
	h.provider.dispose();
});

it("保存失敗ではバックエンド再起動せず、設定とチェックを元に保つ", async () => {
	const h = harness();
	api.update.mockRejectedValueOnce(new Error("read only"));
	await h.sidebar.send({
		type: "ui/setBackend",
		requestId: "backend",
		backend: "pi",
	});
	expect(api.executeCommand).not.toHaveBeenCalled();
	expect(api.restartBackend).not.toHaveBeenCalled();
	expect(h.sidebar.webview.postMessage).toHaveBeenCalledWith(
		expect.objectContaining({
			type: "request/failed",
			requestId: "backend",
		}),
	);
	expect(h.sidebar.webview.postMessage).not.toHaveBeenCalledWith({
		type: "ui/backendState",
		backend: "pi",
	});
	h.provider.dispose();
});
it("保存完了までバックエンド再起動せず、連続した切替要求を重ねない", async () => {
	const h = harness();
	let finish!: () => void;
	api.update.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	await h.sidebar.send({
		type: "ui/setBackend",
		requestId: "first",
		backend: "pi",
	});
	await h.sidebar.send({
		type: "ui/setBackend",
		requestId: "second",
		backend: "pi",
	});
	expect(api.update).toHaveBeenCalledTimes(1);
	expect(api.executeCommand).not.toHaveBeenCalled();
	expect(api.restartBackend).not.toHaveBeenCalled();
	finish();
	await vi.waitFor(() => expect(api.restartBackend).toHaveBeenCalledTimes(1));
	h.provider.dispose();
});
it("同じバックエンドの選択では書き込みやバックエンド再起動をしない", async () => {
	const h = harness();
	await h.sidebar.send({
		type: "ui/setBackend",
		requestId: "same",
		backend: "codex",
	});
	expect(api.update).not.toHaveBeenCalled();
	expect(api.executeCommand).not.toHaveBeenCalled();
	expect(api.restartBackend).not.toHaveBeenCalled();
	h.provider.dispose();
});
it("PiからCodexへ戻すときもworkspaceの指定を更新する", async () => {
	api.get.mockReturnValue("pi");
	api.inspect.mockReturnValue({ workspaceValue: "pi" });
	const h = harness();
	await h.sidebar.send({
		type: "ui/setBackend",
		requestId: "codex",
		backend: "codex",
	});
	expect(api.update).toHaveBeenCalledWith("backend", "codex", 2);
	expect(api.restartBackend).toHaveBeenCalledTimes(1);
	h.provider.dispose();
});
it("保存済みバックエンドを復元し、不正な選択値は両端で拒否する", async () => {
	const h = harness();
	await h.sidebar.send({ type: "ui/ready" });
	expect(h.sidebar.webview.postMessage).toHaveBeenCalledWith({
		type: "ui/backendState",
		backend: "codex",
	});
	for (const backend of [null, "other", 0, {}, undefined]) {
		expect(
			isUiMessage({ type: "ui/setBackend", requestId: "x", backend }),
		).toBe(false);
		expect(isHostMessage({ type: "ui/backendState", backend })).toBe(false);
	}
	for (const backend of ["codex", "pi"]) {
		expect(
			isUiMessage({ type: "ui/setBackend", requestId: "x", backend }),
		).toBe(true);
		expect(isHostMessage({ type: "ui/backendState", backend })).toBe(true);
	}
	h.provider.dispose();
});
it("貼り付けの配置を表示先へ復元し、通常の下書き保存で配置を解除する", async () => {
	const h = harness();
	const draftParts = [
		{ id: "before", type: "text", text: "前" },
		{ id: "block", type: "pasted", text: "コード" },
		{ id: "after", type: "text", text: "後" },
	];
	await h.sidebar.send({
		type: "ui/saveDraft",
		requestId: "draft",
		draft: "前コード後",
		draftParts,
	});
	await h.sidebar.send({ type: "ui/openEditor", requestId: "open" });
	await h.panel.send({ type: "ui/ready" });
	expect(h.panel.webview.postMessage).toHaveBeenLastCalledWith(
		expect.objectContaining({ draft: "前コード後", draftParts }),
	);
	await h.panel.send({ type: "ui/saveDraft", requestId: "clear", draft: "" });
	expect(h.sidebar.webview.postMessage).toHaveBeenLastCalledWith({
		type: "ui/viewState",
		editor: false,
		draft: "",
		scrollTop: 0,
		restoreScroll: false,
	});
	h.provider.dispose();
});
it("エディタの作成・再表示と復元は現在の会話と下書きを引き継ぐ", async () => {
	const h = harness();
	await h.sidebar.send({
		type: "ui/saveDraft",
		requestId: "draft",
		draft: "未送信の入力",
	});
	await h.sidebar.send({
		type: "ui/saveScroll",
		requestId: "scroll",
		scrollTop: 123,
	});
	await h.sidebar.send({ type: "ui/openEditor", requestId: "open" });
	await h.panel.send({ type: "ui/ready" });
	expect(api.createWebviewPanel).toHaveBeenCalledTimes(1);
	expect(h.panel.webview.postMessage).toHaveBeenCalledWith({
		type: "state/snapshot",
		state: h.state,
	});
	expect(h.panel.webview.postMessage).toHaveBeenCalledWith({
		type: "ui/viewState",
		editor: true,
		draft: "未送信の入力",
		scrollTop: 123,
		restoreScroll: true,
	});
	expect(h.sidebar.webview.postMessage).not.toHaveBeenCalled();
	await h.sidebar.send({ type: "ui/openEditor", requestId: "again" });
	expect(api.createWebviewPanel).toHaveBeenCalledTimes(1);
	expect(h.panel.reveal).toHaveBeenCalledWith(-1);
	expect(h.session.receive).not.toHaveBeenCalled();
	h.provider.dispose();
	expect(h.listeners.size).toBe(0);
});
it("パネルからの下書き変更と会話差分は共有し、閉じてもサイドバーを維持する", async () => {
	const h = harness();
	await h.sidebar.send({ type: "ui/openEditor", requestId: "open" });
	await h.panel.send({
		type: "ui/saveDraft",
		requestId: "draft",
		draft: "更新した下書き",
	});
	expect(h.sidebar.webview.postMessage).toHaveBeenCalledWith(
		expect.objectContaining({
			draft: "更新した下書き",
			restoreScroll: false,
		}),
	);
	const event: HostMessage = {
		type: "state/patch",
		revision: 1,
		patch: { connection: "ready" },
	};
	for (const listener of h.listeners) {
		listener(event);
	}
	expect(h.sidebar.webview.postMessage).toHaveBeenCalledWith(event);
	expect(h.panel.webview.postMessage).toHaveBeenCalledWith(event);
	await h.panel.send({ type: "ui/openSidebar", requestId: "back" });
	expect(api.executeCommand).toHaveBeenCalledWith("nerita.codex.chat.focus");
	expect(h.sidebar.show).toHaveBeenCalledWith(false);
	expect(h.listeners.size).toBe(1);
	await h.sidebar.send({ type: "ui/openEditor", requestId: "reopen" });
	expect(api.createWebviewPanel).toHaveBeenCalledTimes(2);
	h.provider.dispose();
});
it("サイドバー破棄後もエディタへ差分を配信し、不正要求を拒否する", async () => {
	const h = harness();
	await h.sidebar.send({ type: "ui/openEditor" });
	expect(api.createWebviewPanel).not.toHaveBeenCalled();
	await h.sidebar.send({ type: "ui/openEditor", requestId: "open" });
	h.sidebar.dispose();
	expect(h.listeners.size).toBe(1);
	const event: HostMessage = {
		type: "state/patch",
		revision: 1,
		patch: { sessionTitle: "新しい名前" },
	};
	for (const listener of h.listeners) {
		listener(event);
	}
	expect(h.panel.webview.postMessage).toHaveBeenCalledWith(event);
	await h.panel.send({
		type: "ui/saveDraft",
		requestId: "invalid",
		draft: 123,
	});
	await h.panel.send({
		type: "ui/saveScroll",
		requestId: "invalid",
		scrollTop: -1,
	});
	await h.panel.send({ type: "ui/ready" });
	expect(h.panel.webview.postMessage).toHaveBeenLastCalledWith(
		expect.objectContaining({ draft: "", scrollTop: 0 }),
	);
	h.provider.dispose();
});
it("パネル作成失敗を要求元へ通知し、再試行を許可する", async () => {
	const h = harness();
	api.createWebviewPanel.mockImplementationOnce(() => {
		throw new Error("Unavailable");
	});
	await h.sidebar.send({ type: "ui/openEditor", requestId: "open" });
	expect(h.sidebar.webview.postMessage).toHaveBeenCalledWith(
		expect.objectContaining({ type: "request/failed", requestId: "open" }),
	);
	await h.sidebar.send({ type: "ui/openEditor", requestId: "retry" });
	expect(h.listeners.size).toBe(2);
	h.provider.dispose();
});
it("パス一覧は要求元のWebviewだけに返し、会話サービスへ転送しない", async () => {
	const h = harness();
	await h.sidebar.send({ type: "ui/openEditor", requestId: "open" });
	await h.panel.send({
		type: "workspace/listPaths",
		requestId: "paths",
		uri: null,
	});
	expect(h.panel.webview.postMessage).toHaveBeenCalledWith({
		type: "workspace/paths",
		requestId: "paths",
		entries: [],
	});
	expect(h.sidebar.webview.postMessage).not.toHaveBeenCalled();
	expect(h.session.receive).not.toHaveBeenCalled();
	h.provider.dispose();
});
it("参照をHostで開き、失敗はクリック元の要求へ返す", async () => {
	const h = harness();
	await h.sidebar.send({
		type: "reference/open",
		requestId: "open-ref",
		uri: "file:///D:/project/a.ts",
	});
	expect(api.executeCommand).toHaveBeenCalledWith(
		"vscode.open",
		expect.anything(),
		expect.objectContaining({ preview: false }),
	);
	expect(h.session.receive).not.toHaveBeenCalled();
	await h.sidebar.send({
		type: "reference/open",
		requestId: "bad-ref",
		uri: "command:unsafe",
	});
	expect(h.sidebar.webview.postMessage).toHaveBeenCalledWith({
		type: "request/failed",
		requestId: "bad-ref",
		error: "参照先を開けませんでした。ファイルやフォルダの存在を確認してください。",
	});
	h.provider.dispose();
});

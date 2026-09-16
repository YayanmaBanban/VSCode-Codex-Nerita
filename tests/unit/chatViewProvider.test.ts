// VS Code境界を差し替え、複数Webviewの復元・購読・パネル再利用を検証する。
import { beforeEach, expect, it, vi } from "vitest";
import { initialState, type HostMessage } from "../../src/shared/messages";

const api = vi.hoisted(() => ({
	createWebviewPanel: vi.fn(),
	executeCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("vscode", () => ({
	window: { createWebviewPanel: api.createWebviewPanel },
	commands: { executeCommand: api.executeCommand },
	ViewColumn: { Active: -1 },
	Uri: {
		parse: (uri: string) => ({ toString: () => uri }),
		joinPath: (_uri: unknown, ...parts: string[]) => ({
			toString: () => parts.join("/"),
		}),
	},
}));
import * as vscode from "vscode";
import { ChatViewProvider } from "../../src/extension/webview/chatViewProvider";

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
			await Promise.resolve();
			await Promise.resolve();
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
	);
	provider.resolveWebviewView(sidebar as unknown as vscode.WebviewView);
	return { provider, sidebar, panel, session, listeners, state };
}
beforeEach(() => {
	vi.clearAllMocks();
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
	expect(api.executeCommand).toHaveBeenCalledWith("codex-acp.chat.focus");
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

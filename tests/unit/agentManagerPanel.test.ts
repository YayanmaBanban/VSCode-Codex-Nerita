// Host のワークスペース照合と保存拒否を、実際の保存処理まで通して確認する。
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebviewPanel, WorkspaceFolder } from "vscode";
import { AgentManagerPanel } from "../../src/extension/agentManager/AgentManagerPanel";
import { defaultHandoff } from "../../src/shared/agentManager/config";
import { initialState } from "../../src/shared/chatState";
import type { BackendSession } from "../../src/extension/session/chatSession";
import type {
	ManagerReply,
	ManagerState,
} from "../../src/shared/agentManager/messages";

const api = vi.hoisted(() => ({ trusted: true, dirty: false, present: true }));
vi.mock("../../src/extension/agentManager/PiAgentSettings", () => ({
	readPiAgents: () =>
		Promise.resolve({
			agents: [],
			defaults: {},
			userSettings: "{}",
			modelScope: "{}",
			fingerprint: "pi",
		}),
}));
vi.mock("vscode", () => ({
	workspace: {
		get isTrusted() {
			return api.trusted;
		},
		get workspaceFolders() {
			return api.present
				? [{ uri: { toString: () => "workspace" } }]
				: [];
		},
		get textDocuments() {
			return [{ isDirty: api.dirty, uri: {} }];
		},
		getWorkspaceFolder: () => ({ uri: { toString: () => "workspace" } }),
		asRelativePath: () => ".nerita/handoff.json",
		getConfiguration: () => ({ get: () => "pi" }),
	},
	commands: { executeCommand: vi.fn() },
}));

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "nerita-manager-panel-"));
	api.trusted = true;
	api.dirty = false;
	api.present = true;
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

/** Webview API の送信だけを置き換える。 */
async function fixture(
	readModels = () =>
		Promise.resolve([
			{ value: "catalog-model", name: "Catalog", efforts: ["low"] },
		]),
	connected = false,
) {
	const replies: ManagerReply[] = [];
	const folder = {
		name: "test",
		uri: { toString: () => "workspace" },
	} as unknown as WorkspaceFolder;
	const panel = {
		webview: {
			postMessage: (message: ManagerReply) => {
				replies.push(message);
				return Promise.resolve(true);
			},
		},
	} as unknown as WebviewPanel;
	const backend = {
		snapshot: () => ({
			...initialState(),
			connection: connected ? "ready" : "disconnected",
		}),
		agentModels: () => [
			{ value: "pi-model", name: "Pi", efforts: ["low", "high"] },
		],
	} as unknown as BackendSession;
	const host = new AgentManagerPanel(
		folder,
		root,
		panel,
		backend,
		"unused",
		readModels,
	);
	await host.publish();
	const state = replies[0] as ManagerState;
	const request = {
		type: "handoff",
		id: 1,
		workspace: state.workspace,
		generation: state.generation,
		config: defaultHandoff(),
	};
	return { host, replies, request };
}

it("saves through the panel and acknowledges the request", async () => {
	const h = await fixture();
	h.host.receive(h.request);
	await vi.waitFor(() =>
		expect(h.replies).toContainEqual(
			expect.objectContaining({ type: "reply", id: 1, error: null }),
		),
	);
	expect(
		JSON.parse(await readFile(join(root, ".nerita/handoff.json"), "utf8")),
	).toEqual(defaultHandoff());
});

it("publishes Codex models and efforts while the chat is connected to Pi", async () => {
	const reader = vi.fn(() =>
		Promise.resolve([
			{ value: "codex-model", name: "Codex", efforts: ["medium"] },
		]),
	);
	const h = await fixture(reader, true);
	const state = h.replies[0] as ManagerState;
	expect(state.models.pi).toEqual([
		{ value: "pi-model", name: "Pi", efforts: ["low", "high"] },
	]);
	expect(state.models.codex).toEqual([
		{ value: "codex-model", name: "Codex", efforts: ["medium"] },
	]);
	expect(reader).toHaveBeenCalledWith("codex", expect.any(AbortSignal));
	expect(reader).toHaveBeenCalledTimes(1);
});

it("shows catalog failure without discarding the other backend", async () => {
	const h = await fixture(
		() => Promise.reject(new Error("unavailable")),
		true,
	);
	const state = h.replies[0] as ManagerState;
	expect(state.models.pi).toHaveLength(1);
	expect(state.models.codex).toEqual([]);
	expect(state.errors).toContain(
		"codex: モデル一覧の取得に失敗しました。再読み込みしてください。",
	);
});

it.each(["workspace", "trust", "dirty", "removed"])(
	"rejects %s mismatch before writing",
	async (condition) => {
		const h = await fixture();
		if (condition === "workspace") {
			h.request.workspace = "other";
		}
		if (condition === "trust") {
			api.trusted = false;
		}
		if (condition === "dirty") {
			api.dirty = true;
		}
		if (condition === "removed") {
			api.present = false;
		}
		h.host.receive(h.request);
		await vi.waitFor(() => {
			const reply = h.replies.find(
				(message) => message.type === "reply" && message.id === 1,
			);
			expect(
				reply?.type === "reply" && typeof reply.error === "string",
			).toBe(true);
		});
		await expect(
			readFile(join(root, ".nerita/handoff.json")),
		).rejects.toMatchObject({ code: "ENOENT" });
	},
);

it("does not save queued requests after the panel is closed", async () => {
	const h = await fixture();
	h.host.receive(h.request);
	h.host.close();
	await new Promise((resolve) => setTimeout(resolve, 10));
	await expect(
		readFile(join(root, ".nerita/handoff.json")),
	).rejects.toMatchObject({ code: "ENOENT" });
});

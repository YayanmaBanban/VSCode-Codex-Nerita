// エディタの要求待ち・文書競合・停止が、子の遅延起動を残さないことを確認する。
import { beforeEach, expect, it, vi } from "vitest";
import type { TextDocument, WebviewPanel } from "vscode";
import type { BackendSession } from "../../src/extension/session/chatSession";
import type { WorkflowReply } from "../../src/shared/workflows/messages";
import { WorkflowPanel } from "../../src/extension/backends/pi/workflows/WorkflowPanel";
import { pending } from "./piHarness";

const api = vi.hoisted(() => ({
	resolve: vi.fn<() => Promise<{ root: string; file: string }>>(),
}));
vi.mock("../../src/extension/backends/pi/workflows/WorkflowDocument", () => ({
	workflowDocument: api.resolve,
}));
vi.mock("vscode", () => ({
	workspace: { asRelativePath: () => ".pi/workflows/test.toml" },
	commands: { executeCommand: () => Promise.resolve() },
}));
beforeEach(() => {
	api.resolve
		.mockReset()
		.mockResolvedValue({ root: "workspace", file: "test.toml" });
});

/** 文書と Webview の境界だけを模擬し、要求の直列化は本体を使う。 */
function fixture() {
	const replies: WorkflowReply[] = [];
	const workflow = vi
		.fn<NonNullable<BackendSession["workflow"]>>()
		.mockResolvedValue("done");
	const document = {
		version: 1,
		isDirty: false,
		uri: {},
		getText: () =>
			'version = 1\nname = "test"\noutputs = ["a"]\n[[steps]]\nid = "a"\nagent = "worker"\ntask = "task"',
	};
	const view = {
		webview: {
			postMessage: (message: WorkflowReply) => {
				replies.push(message);
				return Promise.resolve(true);
			},
		},
	};
	const backend: unknown = { workflow };
	const panel = new WorkflowPanel(
		document as unknown as TextDocument,
		view as unknown as WebviewPanel,
		backend as BackendSession,
	);
	return { panel, replies, workflow, document };
}
it.each(["stop", "close"] as const)(
	"パス検査中の %s で要求を失効させる",
	async (action) => {
		const h = fixture();
		const gate = pending<{ root: string; file: string }>();
		api.resolve.mockReturnValueOnce(gate.promise);
		h.panel.receive({ type: "run", id: 1, version: 1 });
		await vi.waitFor(() => expect(api.resolve).toHaveBeenCalled());
		h.panel[action]();
		gate.resolve({ root: "workspace", file: "test.toml" });
		await gate.promise;
		h.panel.receive({ type: "ready" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(h.workflow).not.toHaveBeenCalled();
	},
);
it("文書の版が異なる要求と未保存の実行を拒否する", async () => {
	const h = fixture();
	h.panel.receive({ type: "run", id: 1, version: 0 });
	await vi.waitFor(() =>
		expect(
			h.replies.some(
				(message) =>
					message.type === "reply" &&
					message.id === 1 &&
					message.error?.includes("別の編集"),
			),
		).toBe(true),
	);
	h.document.isDirty = true;
	h.panel.receive({ type: "run", id: 2, version: 1 });
	await vi.waitFor(() =>
		expect(
			h.replies.some(
				(message) =>
					message.type === "reply" &&
					message.id === 2 &&
					message.error?.includes("保存"),
			),
		).toBe(true),
	);
	expect(h.workflow).not.toHaveBeenCalled();
});
it("長い実行中でも停止要求を先に処理する", async () => {
	const h = fixture();
	h.workflow.mockImplementation(async (_request, signal) => {
		await new Promise<void>((resolve) =>
			signal.addEventListener("abort", () => resolve(), { once: true }),
		);
		signal.throwIfAborted();
		return "done";
	});
	h.panel.receive({ type: "run", id: 1, version: 1 });
	await vi.waitFor(() => expect(h.workflow).toHaveBeenCalled());
	h.panel.receive({ type: "stop" });
	await vi.waitFor(() =>
		expect(h.replies).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ notice: "実行を停止しました。" }),
			]),
		),
	);
});

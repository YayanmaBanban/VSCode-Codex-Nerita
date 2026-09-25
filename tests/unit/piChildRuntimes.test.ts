// 共通 Host 子 Runtime の上限・起動取消し・履歴分離を検証する。
import { expect, it, vi } from "vitest";
import { PiChildRuntimes } from "../../src/extension/backends/pi/PiChildRuntimes";
import type {
	PiRuntimeOptions,
	PiRuntimeSession,
} from "../../src/extension/backends/pi/PiRuntime";
import type { AgentAccessPolicy } from "../../src/extension/security/AgentAccessPolicy";
import { pending } from "./piHarness";

/** SDK 初期化待ちと終了待ちを独立して制御する。 */
function fixture() {
	const abort = new AbortController();
	const policy: AgentAccessPolicy = {
		workspaceRoots: ["D:\\workspace"],
		writableRoots: [],
		networkAccess: false,
		shell: false,
		windowsSandbox: "elevated",
	};
	const options: PiRuntimeOptions = {
		extensionPath: "extension",
		cwd: "D:\\workspace",
		signal: abort.signal,
		authorize: vi.fn(),
		executor: { execute: vi.fn() },
		trustedExtensionPaths: ["D:\\trusted.mjs"],
		getStorage: () => "workspace",
		saveModel: vi.fn(),
	};
	const create =
		vi.fn<(options: PiRuntimeOptions) => Promise<PiRuntimeSession>>();
	const children = new PiChildRuntimes(options, policy, abort.signal, create);
	const session = {
		abort: vi.fn(() => Promise.resolve()),
		dispose: vi.fn(),
		close: vi.fn(() => Promise.resolve()),
	} as unknown as PiRuntimeSession;
	return { abort, policy, options, create, children, session };
}

it("U12 親snapshot・executor・承認先を保持し、内部履歴と外部拡張を継承しない", async () => {
	const h = fixture();
	h.create.mockResolvedValue(h.session);
	h.policy.writableRoots.push("E:\\mutated");
	const role = {
		writableRoots: ["D:\\workspace"],
		shell: true,
		networkAccess: true,
	};
	await h.children.open({ role });
	const passed = h.create.mock.calls[0]![0];
	role.writableRoots.push("E:\\changed");
	expect(passed.parentPolicy!.writableRoots).toEqual([]);
	expect(passed.executor).toBe(h.options.executor);
	expect(passed.authorize).toBe(h.options.authorize);
	expect(passed.role!.writableRoots).toEqual(["D:\\workspace"]);
	expect(passed.ephemeral).toBe(true);
	expect(passed.trustedExtensionPaths).toEqual([]);
	expect(passed.getStorage).toBeUndefined();
	expect(passed.saveModel).toBeUndefined();
	await h.children.stop();
	expect(h.session.abort).toHaveBeenCalledTimes(1);
	expect(h.session.close).toHaveBeenCalledTimes(1);
});

it("U12 起動中Stopをsignalへ伝え、遅れて返ったSDKも回収する", async () => {
	const h = fixture();
	const gate = pending<PiRuntimeSession>();
	h.create.mockReturnValue(gate.promise);
	const opening = h.children.open({ role: {} });
	const rejected = expect(opening).rejects.toThrow();
	const closing = h.children.stop();
	expect(h.create.mock.calls[0]![0].signal.aborted).toBe(true);
	await expect(h.children.open({ role: {} })).rejects.toThrow("終了中");
	gate.resolve(h.session);
	await rejected;
	await closing;
	expect(h.session.close).toHaveBeenCalledTimes(1);
});

it("U12 親切断で実行中の子を停止し、新規起動を拒否する", async () => {
	const h = fixture();
	h.create.mockResolvedValue(h.session);
	await h.children.open({ role: {} });
	h.abort.abort();
	await vi.waitFor(() => expect(h.session.close).toHaveBeenCalledTimes(1));
	await expect(h.children.open({ role: {} })).rejects.toThrow();
});

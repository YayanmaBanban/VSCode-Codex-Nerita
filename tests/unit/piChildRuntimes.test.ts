// 子の起動と親Stopが競合する場合も、権限上限と終了責任を親に固定する。
import { expect, it, vi } from "vitest";
import { PiChildRuntimes } from "../../src/extension/backends/pi/PiChildRuntimes";
import type {
	PiRuntimeOptions,
	PiRuntimeSession,
} from "../../src/extension/backends/pi/PiRuntime";
import type { AgentAccessPolicy } from "../../src/extension/security/AgentAccessPolicy";
import { pending } from "./piHarness";

/** SDK初期化だけを遅延させ、policyと寿命を本番managerへ渡す。 */
function fixture() {
	const policy: AgentAccessPolicy = {
		filesystem: {
			readableRoots: ["workspace"],
			writableRoots: [],
			protectedPaths: ["private"],
		},
		network: { enabled: false },
		command: { mode: "deny" },
	};
	const parent: PiRuntimeOptions = {
		extensionPath: "extension",
		cwd: "workspace",
		workspaceRoots: ["workspace"],
		parentPolicy: policy,
		signal: new AbortController().signal,
		authorize: vi.fn(),
		commandExecutor: { execute: vi.fn() },
	};
	const opening = pending<PiRuntimeSession>();
	const create = vi.fn((_options: PiRuntimeOptions) => opening.promise);
	const lifetime = new AbortController();
	const children = new PiChildRuntimes(
		parent,
		policy,
		lifetime.signal,
		create,
	);
	const abort = vi.fn(() => Promise.resolve());
	const dispose = vi.fn();
	const session = { abort, dispose } as unknown as PiRuntimeSession;
	return {
		policy,
		parent,
		create,
		lifetime,
		children,
		opening,
		session,
		abort,
		dispose,
	};
}

it("親の実効policyを固定し、子からexecutor・承認先・保存先を上書きさせない", async () => {
	const h = fixture();
	h.policy.filesystem.writableRoots = ["workspace"];
	h.policy.filesystem.protectedPaths = [];
	h.policy.network.enabled = true;
	const opening = h.children.open({ accessPolicy: h.policy });
	const input = h.create.mock.calls[0]![0];
	expect(input.parentPolicy.filesystem.writableRoots).toEqual([]);
	expect(input.parentPolicy.filesystem.protectedPaths).toEqual(["private"]);
	expect(input.parentPolicy.network.enabled).toBe(false);
	expect(input.authorize).toBe(h.parent.authorize);
	expect(input.commandExecutor).toBe(h.parent.commandExecutor);
	expect(input.storage).toBe("global");
	expect(input.ephemeral).toBe(true);
	expect(input.resume).toBeUndefined();
	expect(input.trustedExtensionPaths).toEqual([]);
	h.policy.command.mode = "host";
	expect(input.accessPolicy!.command.mode).toBe("deny");
	h.opening.resolve(h.session);
	const child = await opening;
	child.dispose();
	await h.children.stop();
	expect(h.dispose).toHaveBeenCalledOnce();
	expect(h.abort).not.toHaveBeenCalled();
});

it("初期化中のStopはsignalを取消し、遅れて返るSDKも一度だけ回収する", async () => {
	const h = fixture();
	const opening = h.children.open({ accessPolicy: h.policy });
	const rejected = expect(opening).rejects.toThrow();
	const stop = h.children.stop();
	expect(h.create.mock.calls[0]![0].signal.aborted).toBe(true);
	expect(h.children.stop()).toBe(stop);
	await expect(h.children.open({ accessPolicy: h.policy })).rejects.toThrow(
		"終了中",
	);
	h.opening.resolve(h.session);
	await Promise.all([stop, rejected]);
	expect(h.abort).toHaveBeenCalledOnce();
	expect(h.dispose).toHaveBeenCalledOnce();
});

it("親disposeは承認待ちsignalを直ちに取消し、子終了を待たず新規起動を拒否する", async () => {
	const h = fixture();
	const opening = h.children.open({ accessPolicy: h.policy });
	h.opening.resolve(h.session);
	await opening;
	h.children.dispose();
	expect(h.create.mock.calls[0]![0].signal.aborted).toBe(true);
	await h.children.stop();
	await expect(h.children.open({ accessPolicy: h.policy })).rejects.toThrow(
		"終了中",
	);
	expect(h.dispose).toHaveBeenCalledOnce();
});

it("取消済みの親や要求からSDKを生成しない", async () => {
	const h = fixture();
	const request = new AbortController();
	request.abort();
	await expect(
		h.children.open({ accessPolicy: h.policy, signal: request.signal }),
	).rejects.toThrow();
	h.lifetime.abort();
	await expect(h.children.open({ accessPolicy: h.policy })).rejects.toThrow();
	expect(h.create).not.toHaveBeenCalled();
});

it.each(["parent", "request"] as const)(
	"%sのsignal取消しで起動済みSDKを回収する",
	async (source) => {
		const h = fixture();
		const request = new AbortController();
		const opening = h.children.open({
			accessPolicy: h.policy,
			signal: request.signal,
		});
		h.opening.resolve(h.session);
		await opening;
		(source === "parent" ? h.lifetime : request).abort();
		await h.children.stop();
		expect(h.abort).toHaveBeenCalledOnce();
		expect(h.dispose).toHaveBeenCalledOnce();
	},
);

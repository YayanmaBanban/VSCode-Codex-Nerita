// 実ツール境界で承認前の副作用抑止と、実行中への取消伝播を検証する。
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { sandboxFixture } from "./sandboxFixtures";

const fixtures: Awaited<ReturnType<typeof sandboxFixture>>[] = [];
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((item) => item.cleanup()));
});
import { approvePiTool } from "../../src/extension/backends/pi/PiApprovedTools";
import { pending } from "./piHarness";
import type { ToolAuthorizer } from "../../src/extension/security/ApprovalGuard";

/** 副作用の代わりに呼出回数と受け取った `signal` を記録する。 */
async function fixture(name: string) {
	const files = await sandboxFixture();
	fixtures.push(files);
	const execute = vi.fn<ToolDefinition["execute"]>(() =>
		Promise.resolve({
			content: [{ type: "text", text: "done" }],
			details: {},
		}),
	);
	const definition: unknown = { name, execute };
	const tool = definition as ToolDefinition;
	const context: unknown = {};
	const approval = pending<AbortSignal>();
	const authorize = vi.fn<ToolAuthorizer>(() => approval.promise);
	const wrapped = approvePiTool(tool, files.cwd, authorize, files.policy);
	const run = (signal?: AbortSignal) =>
		wrapped.execute(
			"call",
			{ path: "target.txt" },
			signal,
			undefined,
			context as Parameters<ToolDefinition["execute"]>[4],
		);
	return { execute, approval, authorize, run };
}

it.each(["write", "edit", "powershell", "bash", "custom"])(
	"%sは承認前に実行せず、拒否を呼出元へ返す",
	async (name) => {
		const h = await fixture(name);
		const result = h.run();
		const rejected = expect(result).rejects.toThrow("拒否");
		await vi.waitFor(() => expect(h.authorize).toHaveBeenCalled());
		expect(h.execute).not.toHaveBeenCalled();
		expect(
			h.authorize.mock.calls[0]![0].fields?.find(
				(field) => field.id === "params",
			)?.value,
		).toContain("target.txt");
		expect(h.authorize.mock.calls[0]![1]?.aborted).toBe(false);
		h.approval.reject(new Error("拒否"));
		await rejected;
		expect(h.execute).not.toHaveBeenCalled();
	},
);

it.each(["host", "sdk", "host-only"])(
	"承認後も%sの取消を実ツールへ伝える",
	async (source) => {
		const h = await fixture("powershell");
		const host = new AbortController();
		const sdk = new AbortController();
		const result = h.run(source === "host-only" ? undefined : sdk.signal);
		h.approval.resolve(host.signal);
		await result;
		const received = h.execute.mock.calls[0]![2]!;
		expect(received.aborted).toBe(false);
		(source === "sdk" ? sdk : host).abort();
		expect(received.aborted).toBe(true);
	},
);

it("許可の直後にHostが停止した場合は実ツールを呼ばない", async () => {
	const h = await fixture("write");
	const host = new AbortController();
	const result = h.run();
	const rejected = expect(result).rejects.toThrow();
	h.approval.resolve(host.signal);
	host.abort();
	await rejected;
	expect(h.execute).not.toHaveBeenCalled();
});

// 差分資料が通常送信・追加指示へ届き、取得失敗や接続変更では送信しないことを確認する。
import { afterEach, expect, it, vi } from "vitest";
import { codexHarness, deferred } from "./codexHarness";
import type { AdditionalContext } from "../../src/extension/backends/codex/context/additionalContext";
import type { HostMessage } from "../../src/shared/messages";
import { ChangeContextError } from "../../src/extension/backends/codex/context/changeContext";
import type * as ChangeContextModule from "../../src/extension/backends/codex/context/changeContext";

const context = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock(
	"../../src/extension/backends/codex/context/changeContext",
	async (original) => ({
		...(await original<typeof ChangeContextModule>()),
		changeContext: context.read,
	}),
);
vi.mock("vscode", () => ({ workspace: {}, window: {} }));
const harnesses: ReturnType<typeof codexHarness>[] = [];
afterEach(async () => {
	await Promise.all(
		harnesses.splice(0).map(({ session }) => session.dispose()),
	);
	context.read.mockReset();
});
/** 差分参照を送る接続済みセッションを準備する。 */
async function connected() {
	const h = codexHarness();
	harnesses.push(h);
	await h.session.connect();
	return h;
}
/** チップから得た範囲だけを送信する。 */
function send(h: ReturnType<typeof codexHarness>) {
	return h.session.receive({
		type: "prompt/send",
		requestId: crypto.randomUUID(),
		sessionId: h.session.snapshot().sessionId,
		text: "[Changes: Staged] review",
		changeScopes: ["staged"],
	});
}
it("通常送信と追加指示の両方に送信時の差分を渡す", async () => {
	const h = await connected();
	const first = { "git:staged": { kind: "untrusted", value: "first diff" } };
	context.read.mockResolvedValue(first);
	await send(h);
	expect(context.read).toHaveBeenCalledWith("D:/workspace", ["staged"]);
	expect(h.client.startTurn).toHaveBeenCalledWith(
		expect.objectContaining({ additionalContext: first }),
	);
	const next = { "git:staged": { kind: "untrusted", value: "updated diff" } };
	context.read.mockResolvedValue(next);
	await send(h);
	expect(h.client.steerTurn).toHaveBeenCalledWith(
		expect.objectContaining({ additionalContext: next }),
	);
});
it("差分取得失敗は受付せず、具体的な理由を返す", async () => {
	const h = await connected();
	const events: HostMessage[] = [];
	h.session.subscribe((message) => events.push(message));
	context.read.mockRejectedValue(new ChangeContextError("branch"));
	await send(h);
	expect(h.client.startTurn).not.toHaveBeenCalled();
	expect(events.at(-1)).toMatchObject({
		type: "request/failed",
		error: expect.stringContaining("mainブランチ") as unknown,
	});
});
it("差分の取得中に接続が変わった場合は送信しない", async () => {
	const h = await connected();
	const pending = deferred<AdditionalContext>();
	context.read.mockReturnValue(pending.promise);
	const sending = send(h);
	h.session.invalidate();
	pending.resolve({ "git:staged": { kind: "untrusted", value: "old diff" } });
	await sending;
	expect(h.client.startTurn).not.toHaveBeenCalled();
});

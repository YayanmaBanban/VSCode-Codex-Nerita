// 外部アカウントを使わず、補足判定と承認・取消しの境界を検証する。
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	JevGuard,
	reviewWithJev,
	summarizeJevCall,
} from "../../apps/vscode-nerita/src/extension/security/JevGuard";
import { createJevReviewer } from "../../apps/vscode-nerita/src/extension/security/JevClient";
import { approveToolCall } from "../../apps/vscode-nerita/src/extension/security/ApprovalGuard";
import {
	consumeApprovedToolCall,
	type ToolCall,
} from "../../apps/vscode-nerita/src/extension/security/ApprovedToolCall";
import { guardrailRegistry } from "../../apps/vscode-nerita/src/extension/security/GuardrailRegistry";
import { defaultGuardrails } from "@nerita/shared/guardrails/config";
import { sandboxFixture } from "./sandboxFixtures";

let fixture: Awaited<ReturnType<typeof sandboxFixture>>;
let call: ToolCall;
let guard: JevGuard;
const authorize = vi.fn(() => Promise.resolve(new AbortController().signal));
beforeEach(async () => {
	fixture = await sandboxFixture();
	guard = new JevGuard();
	authorize.mockClear();
	call = {
		tool: "powershell",
		params: { command: "git status" },
		command: ["powershell", "git status"],
		cwd: fixture.cwd,
		policy: fixture.policy,
	};
});
afterEach(async () => {
	guard.configure();
	guardrailRegistry.dispose();
	await fixture.cleanup();
});

it("未設定では補足判定を付けず、既存の承認を維持する", async () => {
	const permit = await approveToolCall(call, authorize, undefined, guard);
	expect(consumeApprovedToolCall(permit).jevReview).toBeUndefined();
	expect(authorize).toHaveBeenCalledOnce();
});

it.each(["allow", "confirm", "review"])(
	"Jevの%sでも毎回承認し、判定を固定する",
	async (decision) => {
		const review = { decision, guidance: "補足理由" };
		guard.configure(() => Promise.resolve(review));
		const permit = await approveToolCall(call, authorize, undefined, guard);
		expect(authorize).toHaveBeenCalledOnce();
		expect(JSON.stringify(authorize.mock.calls)).toContain("補足理由");
		review.decision = "deny";
		review.guidance = "変更後の理由";
		expect(consumeApprovedToolCall(permit).jevReview).toMatchObject({
			decision,
			guidance: "補足理由",
		});
	},
);

it("Jevの拒否は承認を出さず、許可を発行しない", async () => {
	guard.configure(() =>
		Promise.resolve({ decision: "deny", guidance: "危険" }),
	);
	await expect(
		approveToolCall(call, authorize, undefined, guard),
	).rejects.toThrow("Jevが実行を拒否");
	expect(authorize).not.toHaveBeenCalled();
});

it("ローカルの拒否とworkspace内readはJevを呼ばない", async () => {
	const reviewer = vi.fn(() =>
		Promise.resolve({ decision: "allow", guidance: "ok" }),
	);
	guard.configure(reviewer);
	const config = defaultGuardrails();
	config.commandRules.push({
		id: "blocked",
		shell: "any",
		match: "contains",
		pattern: "git status",
		action: "deny",
		reason: "禁止",
	});
	guardrailRegistry.apply(fixture.cwd, config);
	await expect(
		approveToolCall(call, authorize, undefined, guard),
	).rejects.toThrow("禁止");
	await approveToolCall(
		{
			tool: "read",
			cwd: call.cwd,
			policy: call.policy,
			params: { path: "a" },
		},
		authorize,
		undefined,
		guard,
	);
	expect(reviewer).not.toHaveBeenCalled();
	expect(authorize).not.toHaveBeenCalled();
});

it.each([
	null,
	{ decision: "unknown", guidance: "bad" },
	{ decision: "allow" },
])("不正応答は確認へ戻す: %j", async (response) => {
	guard.configure(() => Promise.resolve(response));
	const permit = await approveToolCall(call, authorize, undefined, guard);
	expect(permit.call.jevReview?.status).toBe("unavailable");
	expect(authorize).toHaveBeenCalledOnce();
});

it("通信エラー本文を承認画面へ流さない", async () => {
	guard.configure(() => Promise.reject(new Error("secret-server-error")));
	const permit = await approveToolCall(call, authorize, undefined, guard);
	expect(permit.call.jevReview?.decision).toBe("confirm");
	expect(JSON.stringify(authorize.mock.calls)).not.toContain(
		"secret-server-error",
	);
});

it("応答しない接続も時間切れで確認へ戻す", async () => {
	const result = await reviewWithJev(
		() => new Promise(() => {}),
		call,
		new AbortController().signal,
		10,
	);
	expect(result.status).toBe("unavailable");
});

it.each(["stop", "guardrails", "connection"])(
	"判定待ちの%sで中断し、承認を出さない",
	async (kind) => {
		const reviewer = vi.fn(() => new Promise(() => {}));
		guard.configure(reviewer);
		const controller = new AbortController();
		const approval = approveToolCall(
			call,
			authorize,
			controller.signal,
			guard,
		);
		const rejected = expect(approval).rejects.toThrow();
		await vi.waitFor(() => expect(reviewer).toHaveBeenCalled());
		if (kind === "stop") {
			controller.abort();
		}
		if (kind === "guardrails") {
			guardrailRegistry.apply(fixture.cwd, defaultGuardrails());
		}
		if (kind === "connection") {
			guard.configure();
		}
		await rejected;
		expect(authorize).not.toHaveBeenCalled();
	},
);

it("接続を変更すると承認済みの許可も失効する", async () => {
	const permit = await approveToolCall(call, authorize, undefined, guard);
	guard.configure(() =>
		Promise.resolve({ decision: "deny", guidance: "変更" }),
	);
	expect(() => consumeApprovedToolCall(permit)).toThrow("再承認");
});

it("要約へコマンド・本文・パス・環境変数・任意Tool名を出さない", () => {
	const summary = summarizeJevCall({
		...call,
		tool: "extension:private",
		env: { TOKEN: "secret" },
		params: { secret: "private body" },
	});
	const json = JSON.stringify(summary);
	for (const value of [
		"secret",
		"private",
		"git status",
		fixture.cwd,
		"TOKEN",
	]) {
		expect(json).not.toContain(value);
	}
	expect(summary.tool).toBe("extension");
});

it("公式API契約で送信し、認証はヘッダーだけに付ける", async () => {
	const transport = vi.fn<typeof fetch>(() =>
		Promise.resolve(
			Response.json({
				code: 0,
				data: { decision: "review", guidance: "確認" },
			}),
		),
	);
	const review = createJevReviewer("test-key", transport);
	const signal = new AbortController().signal;
	expect(await review(summarizeJevCall(call), signal)).toEqual({
		decision: "review",
		guidance: "確認",
	});
	expect(transport).toHaveBeenCalledWith(
		"https://www.jevai.org/api/v1/decisions/tool-guard",
		expect.objectContaining({
			method: "POST",
			signal,
			redirect: "error",
			headers: {
				Authorization: "Bearer test-key",
				"Content-Type": "application/json",
			},
		}),
	);
	expect(transport.mock.calls[0]?.[1]?.body).not.toContain("test-key");
});

it.each(["http", "code", "invalid"])(
	"APIの%sエラーを拒否する",
	async (kind) => {
		let response = Response.json({
			code: 1,
			data: { decision: "allow", guidance: "ok" },
		});
		if (kind === "http") {
			response = new Response("secret", { status: 401 });
		}
		if (kind === "invalid") {
			response = new Response("not json");
		}
		const reviewer = createJevReviewer("test-key", () =>
			Promise.resolve(response),
		);
		await expect(
			reviewer(summarizeJevCall(call), new AbortController().signal),
		).rejects.toThrow();
	},
);

it("有効な多バイト応答を32KiBまで受け入れ、分割受信でも超過を拒否する", async () => {
	const body = JSON.stringify({
		code: 0,
		data: { decision: "allow", guidance: "確認" },
	});
	const bytes = Buffer.from(
		body + " ".repeat(32768 - Buffer.byteLength(body)),
	);
	const response = (extra: boolean) =>
		new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(bytes.subarray(0, 53));
					controller.enqueue(bytes.subarray(53));
					if (extra) {
						controller.enqueue(new Uint8Array([32]));
					}
					controller.close();
				},
			}),
		);
	const reviewer = (extra: boolean) =>
		createJevReviewer("test-key", () => Promise.resolve(response(extra)));
	const input = summarizeJevCall(call);
	const signal = new AbortController().signal;
	expect(await reviewer(false)(input, signal)).toEqual({
		decision: "allow",
		guidance: "確認",
	});
	const outcome = await reviewer(true)(input, signal).then(
		() => "accepted",
		(error: unknown) => (error instanceof Error ? error.message : error),
	);
	expect(outcome).toBe("Jevの応答が上限を超えています。");
});

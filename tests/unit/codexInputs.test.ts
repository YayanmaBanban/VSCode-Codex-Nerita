// 認証・添付・サーバー質問の検証と取消を、秘密情報を外部へ送らず確認する。
import { expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AuthFlow } from "../../src/extension/codex/interaction/AuthFlow";
import { attachmentInput } from "../../src/extension/codex/context/attachmentInput";
import { interactionRequest } from "../../src/extension/codex/interaction/interactionRequests";
import type { InteractionService } from "../../src/extension/codex/interaction/interactionService";
import { permissionProfile } from "../../src/extension/codex/settings/permissionProfile";
import { deferred } from "./codexHarness";

it("ログイン開始応答より早い完了通知を保持する", async () => {
	const flow = new AuthFlow();
	const client = {
		login: vi.fn(async () => {
			await Promise.resolve();
			flow.notification({
				method: "account/login/completed",
				params: { loginId: "id", success: true },
			});
			return {
				type: "chatgpt" as const,
				loginId: "id",
				authUrl: "https://auth.openai.com/authorize",
			};
		}),
		cancelLogin: vi.fn(() => Promise.resolve({ status: "cancelled" })),
	};
	const open = vi.fn(() => Promise.resolve());
	await flow.start(
		client,
		"chatgpt",
		{ open, apiKey: () => undefined },
		new AbortController().signal,
	);
	expect(open).toHaveBeenCalledWith("https://auth.openai.com/authorize");
});
it("ブラウザ認証を取消し、別loginIdの通知では完了させない", async () => {
	const flow = new AuthFlow();
	const abort = new AbortController();
	const client = {
		login: vi.fn(() =>
			Promise.resolve({
				type: "chatgpt" as const,
				loginId: "id",
				authUrl: "https://auth.openai.com/authorize",
			}),
		),
		cancelLogin: vi.fn(() => Promise.resolve({ status: "cancelled" })),
	};
	const open = vi.fn(() => Promise.resolve());
	const login = flow.start(
		client,
		"chatgpt",
		{ open, apiKey: () => undefined },
		abort.signal,
	);
	const rejected = expect(login).rejects.toThrow("cancelled");
	await vi.waitFor(() => expect(open).toHaveBeenCalled());
	flow.notification({
		method: "account/login/completed",
		params: { loginId: "other", success: true },
	});
	abort.abort();
	await rejected;
	expect(client.cancelLogin).toHaveBeenCalledWith("id");
});
it("認証URLの偽装と空のAPIキーを受け付けない", async () => {
	const flow = new AuthFlow();
	const open = vi.fn(() => Promise.resolve());
	const client = {
		login: vi.fn(() =>
			Promise.resolve({
				type: "chatgpt" as const,
				loginId: "id",
				authUrl: "https://example.com/",
			}),
		),
		cancelLogin: vi.fn(() => Promise.resolve({ status: "cancelled" })),
	};
	await expect(
		flow.start(
			client,
			"chatgpt",
			{ open, apiKey: () => undefined },
			new AbortController().signal,
		),
	).rejects.toThrow();
	expect(open).not.toHaveBeenCalled();
	await expect(
		flow.start(
			client,
			"apiKey",
			{ open, apiKey: () => undefined },
			new AbortController().signal,
		),
	).rejects.toThrow();
	expect(client.login).toHaveBeenCalledTimes(1);
});
it("UTF-8添付・画像参照を変換し、バイナリと容量超過を拒否する", async () => {
	const dir = await mkdtemp(join(tmpdir(), "codex-input-"));
	const file = (name: string) => ({
		id: name,
		name,
		uri: pathToFileURL(join(dir, name)).href,
	});
	try {
		await writeFile(join(dir, "日本語.txt"), "添付内容");
		expect(await attachmentInput([file("日本語.txt")], false)).toEqual([
			expect.objectContaining({
				type: "text",
				text: expect.stringContaining("添付内容") as unknown,
			}),
		]);
		expect(await attachmentInput([file("test.png")], true)).toEqual([
			{ type: "localImage", path: join(dir, "test.png") },
		]);
		await expect(
			attachmentInput([file("test.png")], false),
		).rejects.toThrow();
		await writeFile(join(dir, "binary.bin"), Buffer.from([0, 255]));
		await expect(
			attachmentInput([file("binary.bin")], false),
		).rejects.toThrow();
		await writeFile(
			join(dir, "large.txt"),
			Buffer.alloc(2 * 1024 * 1024 + 1),
		);
		await expect(
			attachmentInput([file("large.txt")], false),
		).rejects.toThrow();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
/** 外部のUIを開かない入力サービス。 */
function dialogs() {
	return {
		input: vi.fn<InteractionService["input"]>(),
		choose: vi.fn<InteractionService["choose"]>(),
		open: vi.fn<InteractionService["open"]>(),
	};
}
it("ユーザー質問の選択肢と秘密入力を元の質問IDへ返す", async () => {
	const ui = dialogs();
	ui.choose.mockResolvedValueOnce("A");
	ui.input.mockResolvedValueOnce("secret");
	const result = await interactionRequest(
		{
			id: 1,
			method: "item/tool/requestUserInput",
			params: {
				questions: [
					{
						id: "choice",
						question: "選択",
						options: [{ label: "A" }],
						isOther: false,
						isSecret: false,
					},
					{
						id: "password",
						question: "秘密",
						options: null,
						isSecret: true,
					},
				],
			},
		},
		ui,
		new AbortController().signal,
	);
	expect(result).toEqual({
		answers: {
			choice: { answers: ["A"] },
			password: { answers: ["secret"] },
		},
	});
	expect(ui.input).toHaveBeenCalledWith(
		"秘密",
		true,
		expect.any(AbortSignal),
	);
});
it("MCPフォームは数値の制約を検証して送信し、取消時は回答しない", async () => {
	const ui = dialogs();
	ui.input.mockResolvedValue("3");
	ui.choose.mockResolvedValue("送信");
	const request = {
		id: 1,
		method: "mcpServer/elicitation/request",
		params: {
			mode: "form",
			serverName: "test",
			message: "人数",
			requestedSchema: {
				type: "object",
				properties: {
					count: { type: "integer", minimum: 1, maximum: 5 },
				},
				required: ["count"],
			},
		},
	};
	expect(
		await interactionRequest(request, ui, new AbortController().signal),
	).toEqual({ action: "accept", content: { count: 3 }, _meta: null });
	const validate = ui.input.mock.calls[0]?.[3];
	expect(validate?.("6")).toBeTruthy();
	ui.input.mockResolvedValue(undefined);
	expect(
		await interactionRequest(request, ui, new AbortController().signal),
	).toMatchObject({ action: "cancel", content: null });
});
it("質問待ちの取消後は入力結果を返さない", async () => {
	const ui = dialogs(),
		input = deferred<string | undefined>(),
		abort = new AbortController();
	ui.input.mockReturnValue(input.promise);
	const result = interactionRequest(
		{
			id: 1,
			method: "item/tool/requestUserInput",
			params: {
				questions: [{ id: "q", question: "確認", options: null }],
			},
		},
		ui,
		abort.signal,
	);
	abort.abort();
	input.resolve("late");
	expect(await result).toEqual({ answers: {} });
});
it("追加権限は要求された範囲を検証し未知の形式は許可しない", () => {
	expect(
		permissionProfile({
			network: { enabled: true },
			fileSystem: { read: null, write: ["D:/workspace"] },
		}),
	).toEqual({
		network: { enabled: true },
		fileSystem: { read: null, write: ["D:/workspace"] },
	});
	expect(() =>
		permissionProfile({ fileSystem: { entries: [{ unknown: true }] } }),
	).toThrow();
});

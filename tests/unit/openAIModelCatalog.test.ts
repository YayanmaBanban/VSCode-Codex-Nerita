// 固定エンドポイント・OAuth 更新・account キャッシュと不正 HTTP 応答の公開境界を検証する。
import { describe, expect, it, vi } from "vitest";
import { OpenAIModelCatalogService } from "../../apps/vscode-nerita/src/extension/backends/pi/openai/OpenAIModelCatalogService";
import { catalogHarness, oauthToken } from "./piCatalogHarness";

describe("Codex OAuth live catalog transport", () => {
	it("SDK認証を使い、固定URL・version・redirect禁止で取得する", async () => {
		const h = catalogHarness();
		await h.account.refreshCatalog(h.signal);
		expect(h.models.getAuth).toHaveBeenCalled();
		expect(h.request).toHaveBeenCalledWith(
			`https://api.openai.com/v1/models?client_version=0.999.0`,
			expect.objectContaining({
				redirect: "error",
				headers: {
					Authorization: `Bearer ${oauthToken()}`,
					Accept: "application/json",
				},
			}),
		);
	});

	it("account変更後は前accountのcacheを返さない", async () => {
		const h = catalogHarness();
		const reader = new OpenAIModelCatalogService(h.sdkModels, h.request);
		expect(await reader.read(h.signal)).not.toBeNull();
		h.models.getAuth.mockResolvedValue({
			auth: { apiKey: oauthToken("another-account") },
		});
		h.request.mockRejectedValue(new Error("secret"));
		expect(await reader.read(h.signal)).toBeNull();
	});

	it.each(["redirect", "json", "schema", "size", "unauthorized"])(
		"%s失敗は安全なnullへ変換する",
		async (failure) => {
			const h = catalogHarness();
			const responses = {
				redirect: new Response(null, {
					status: 302,
					headers: { Location: "https://example.org" },
				}),
				json: new Response("private-invalid-body"),
				schema: Response.json({ message: "private-response" }),
				size: new Response(" ".repeat(2 * 1024 * 1024 + 1)),
				unauthorized: new Response("secret", { status: 401 }),
			};
			h.request.mockResolvedValue(
				responses[failure as keyof typeof responses],
			);
			expect(
				await new OpenAIModelCatalogService(
					h.sdkModels,
					h.request,
				).read(h.signal),
			).toBeNull();
		},
	);

	it("5秒timeoutで要求を取り消す", async () => {
		vi.useFakeTimers();
		// `AbortSignal.timeout` は実時間のため、このテストでは同じ境界を仮想時計へ接続する。
		const timeout = vi
			.spyOn(AbortSignal, "timeout")
			.mockImplementation((ms) => {
				const abort = new AbortController();
				setTimeout(() => abort.abort(), ms);
				return abort.signal;
			});
		try {
			const h = catalogHarness();
			h.request.mockImplementation(
				(_url, options) =>
					new Promise((_resolve, reject) =>
						options!.signal!.addEventListener(
							"abort",
							() => reject(new Error("private-timeout")),
							{ once: true },
						),
					),
			);
			const reading = new OpenAIModelCatalogService(
				h.sdkModels,
				h.request,
			).read(h.signal);
			await vi.advanceTimersByTimeAsync(5000);
			expect(await reading).toBeNull();
			expect(timeout).toHaveBeenCalledWith(5000);
		} finally {
			timeout.mockRestore();
			vi.useRealTimers();
		}
	});

	it("APIキーと取消では取得せず、opaque OAuth tokenは公開APIで使える", async () => {
		const h = catalogHarness();
		h.models.checkAuth.mockResolvedValue({ type: "api_key" });
		const reader = new OpenAIModelCatalogService(h.sdkModels, h.request);
		expect(await reader.read(h.signal)).toBeNull();
		h.models.checkAuth.mockResolvedValue({ type: "oauth" });
		h.models.getAuth.mockResolvedValue({
			auth: { apiKey: "invalid-secret-token" },
		});
		expect(await reader.read(h.signal)).not.toBeNull();
		h.request.mockClear();
		expect(await reader.read(AbortSignal.abort())).toBeNull();
		expect(h.request).not.toHaveBeenCalled();
	});
});

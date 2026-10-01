// 構造化結果の空欄補完、秘密値の除去、有限の表示予算を検証する。
import { expect, it } from "vitest";
import { piResultDisplay } from "../../apps/vscode-nerita/src/extension/backends/pi/results/PiResultDisplay";

/** Webview へ渡すプレーンテキストだけを観測する。 */
function text(result: ReturnType<typeof piResultDisplay>): string {
	return (
		result.content
			?.map(
				(part: unknown) =>
					(part as { content: { text: string } }).content.text,
			)
			.join("\n") ?? ""
	);
}

it("空白だけの本文を補い、有用な本文と画像説明があれば構造化結果を重複表示しない", () => {
	const structuredContent = { count: 3 };
	expect(
		JSON.parse(
			text(
				piResultDisplay({
					content: [{ type: "text", text: " \n" }],
					structuredContent,
				}),
			),
		),
	).toEqual(structuredContent);
	for (const part of [
		{ type: "text", text: "本文" },
		{ type: "image", data: "private-image" },
	]) {
		const display = piResultDisplay({ content: [part], structuredContent });
		expect(text(display)).toBe(
			part.type === "text" ? "本文" : "画像を読み取りました。",
		);
		expect(display.resultDisplay).toBeUndefined();
	}
});

it("MCP結果はHostの出所情報でだけ展開し、自己申告のdetailsでは判定しない", () => {
	const result = {
		content: [],
		details: { source: "mcp" },
		structuredContent: {
			content: [],
			structuredContent: { count: 3 },
			_meta: { secret: "never-show" },
		},
	};
	expect(
		JSON.parse(text(piResultDisplay(result, { mcpEnvelope: true }))),
	).toEqual({ count: 3 });
	expect(text(piResultDisplay(result))).toContain('"structuredContent"');
	expect(text(piResultDisplay(result))).not.toContain("never-show");
});

it("非公開キー・既知の秘密値・base64・バイナリー・getterを表示せず、HTMLは文字列のまま渡す", () => {
	let reads = 0;
	const value = {
		Authorization: "secret-auth",
		_meta: { private: "secret-meta" },
		harmless: "prefix host-private suffix",
		html: "<script>danger()</script>",
		data: "data:image/png;base64,cHJpdmF0ZQ==",
		bytes: new Uint8Array([1, 2]),
		get hidden() {
			reads++;
			throw new Error("private-error");
		},
	};
	const display = piResultDisplay(
		{ structuredContent: value },
		{ secrets: ["host-private"] },
	);
	for (const privateValue of [
		"secret-auth",
		"secret-meta",
		"host-private",
		"cHJpdmF0ZQ",
		"private-error",
	]) {
		expect(text(display)).not.toContain(privateValue);
	}
	expect(text(display)).toContain("<script>danger()</script>");
	expect(reads).toBe(0);
	expect(
		text(piResultDisplay({ structuredContent: value.data })),
	).not.toContain("cHJpdmF0ZQ");
	expect(
		text(
			piResultDisplay({
				content: [
					{
						type: "text",
						get text() {
							throw new Error("invalid");
						},
					},
				],
				structuredContent: { count: 3 },
			}),
		),
	).toContain('"count": 3');
	expect(display.resultDisplay).toEqual({
		source: "structuredContent",
		omitted: true,
	});
});

it("巨大な入力を全体JSON化せず、UTF-8文字列・全体・項目数・深さを制限する", () => {
	let reads = 0;
	const many = Object.fromEntries(
		Array.from({ length: 1000 }, (_, i) => [
			`item${i}`,
			"日本語".repeat(10000),
		]),
	);
	Object.defineProperty(many, "toJSON", {
		enumerable: false,
		value: () => {
			reads++;
			throw new Error("full serialization");
		},
	});
	const display = piResultDisplay({ structuredContent: many });
	expect(Buffer.byteLength(text(display), "utf8")).toBeLessThanOrEqual(32768);
	expect(text(display)).not.toContain("�");
	expect(text(display)).toContain("一部を省略");
	expect(reads).toBe(0);
	const items = piResultDisplay({
		structuredContent: Array.from({ length: 60 }, (_, i) => i),
	});
	expect(text(items)).not.toMatch(/\b50\b/);
	let nested: unknown = "too-deep";
	for (let i = 0; i < 10; i++) {
		nested = { nested };
	}
	expect(text(piResultDisplay({ structuredContent: nested }))).not.toContain(
		"too-deep",
	);
});

it("循環と非対応の値は説明にし、後続カードの表示を止めない", () => {
	const circular: Record<string, unknown> = { valid: 3, invalid: 1n };
	circular.self = circular;
	const display = piResultDisplay({ structuredContent: circular });
	expect(text(display)).toContain("循環参照");
	expect(text(display)).toContain('"valid": 3');
	expect(text(display)).toContain("非対応の値");
});

it("上限をまたぐHostの秘密値を断片でも漏らさず、MCP本文にも同じ確認を適用する", () => {
	const secret = "SECRET-BEYOND-LIMIT";
	const display = piResultDisplay(
		{
			content: [
				{ type: "text", text: `${"あ".repeat(1360)}${secret}終端` },
			],
			structuredContent: { unused: true },
		},
		{ mcpEnvelope: true, secrets: [secret] },
	);
	expect(text(display)).not.toContain("SECRET");
	expect(text(display)).not.toContain("unused");
	expect(Buffer.byteLength(text(display), "utf8")).toBeLessThanOrEqual(32768);
	expect(display.resultDisplay).toEqual({ source: "content", omitted: true });
});

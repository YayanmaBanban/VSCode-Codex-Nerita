// 複数行コードの参照化・クリック・送信と、遅い応答による上書き防止を確認する。
import { test, expect } from "@playwright/test";
import { paste } from "./composerHelpers";

const code =
	"let controller: BackendSession | undefined;\n/** サイドバーを登録する。 */\nexport function activate(context: vscode.ExtensionContext): void {\n\tconst session = createBackend(context);";

for (const colorScheme of ["dark", "light"] as const) {
	test(`コード本文から参照を作り本文なしで送信する: ${colorScheme}`, async ({
		page,
	}, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.setViewportSize({ width: 320, height: 820 });
		await page.emulateMedia({ colorScheme });
		await page.goto(
			"/iframe.html?id=chat-composer-copied-code--ready&viewMode=story",
		);
		const input = page.getByRole("textbox", {
			name: "Codexへのメッセージ",
		});
		await input.fill("#");
		await paste(input, code.replaceAll("\n", "\r\n"));
		await expect(input.locator(".inline-path-reference")).toHaveText(
			"extension.ts(8:11)",
		);
		await input
			.getByRole("button", { name: "extension.ts を開く", exact: true })
			.click();
		await expect(page.getByLabel("開いたコード")).toContainText(
			'"character":40',
		);
		await info.attach("copied-code-chip", {
			body: await page.screenshot({
				path: info.outputPath("copied-code.png"),
			}),
			contentType: "image/png",
		});
		await input.press("Control+End");
		await input.press("Control+Enter");
		const sent: unknown = JSON.parse(
			(await page.getByLabel("送信した参照").textContent())!,
		);
		expect(sent).toMatchObject({
			codeReferences: [
				{
					uri: "file:///D:/workspace/project/src/extension.ts",
					range: {
						start: { line: 8, character: 0 },
						end: { line: 11, character: 40 },
					},
				},
			],
		});
		await expect(page.getByLabel("送信した参照")).not.toContainText(
			"let controller",
		);
		expect(errors).toEqual([]);
	});
}

test("照合できない本文を残し、Undoした貼り付けを遅い応答で復活させない", async ({
	page,
}) => {
	await page.goto(
		"/iframe.html?id=chat-composer-copied-code--ready&viewMode=story",
	);
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.fill("#");
	await paste(input, "unknown();\nunknown();");
	await expect(input).toContainText("unknown();");
	await expect(page.getByLabel("照合完了数")).toHaveText("1");
	await input.fill("#");
	await paste(input, code);
	await input.press("Control+z");
	await expect(input).toHaveText("#");
	// 後続の照合を完了させ、先行応答を処理した後にも復活していないことを確認する。
	await paste(input, "plain text");
	await expect(input).toContainText("plain text");
	await expect(page.getByLabel("照合完了数")).toHaveText("3");
	await expect(input.locator(".inline-path-reference")).toHaveCount(0);
});

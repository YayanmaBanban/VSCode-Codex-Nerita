// 改行を含む入力を取り消しても、削除済みの文字が復活しないことを確認する。
import { test, expect } from "@playwright/test";

test("複数行の入力を順にUndoしRedoで復元できる", async ({ page }, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {errors.push(message.text());}
	});
	await page.goto("/iframe.html?id=chat-app--empty&viewMode=story");
	// VS Code が外側で受け取ったキーを標準編集コマンドへ転送する経路を再現する。
	await page.evaluate(() => {
		window.addEventListener("keydown", (event) => {
			if (event.ctrlKey && ["z", "y"].includes(event.key)) {
				document.execCommand(event.key === "z" ? "undo" : "redo");
			}
		});
	});
	const input = page.getByRole("textbox", { name: "Codexへのメッセージ" });
	await input.click();
	const cdp = await page.context().newCDPSession(page);
	for (const character of ["あ", "い", "う", "え", "お"]) {
		if (character !== "あ") {await input.press("Enter");}
		await cdp.send("Input.imeSetComposition", {
			text: character,
			selectionStart: 1,
			selectionEnd: 1,
		});
		await cdp.send("Input.insertText", { text: character });
	}
	await page.screenshot({ path: info.outputPath("five-lines.png") });
	let previous = (await input.innerText()).replace(/\n/g, "");
	expect(previous).toBe("あいうえお");
	const states = [previous];
	for (let attempt = 0; previous && attempt < 15; attempt++) {
		await input.press("Control+z");
		const current = (await input.innerText()).replace(/\n/g, "");
		expect(previous.startsWith(current), `${previous} -> ${current}`).toBe(
			true,
		);
		states.push(current);
		previous = current;
	}
	expect(previous).toBe("");
	await page.screenshot({ path: info.outputPath("undone.png") });
	for (const expected of states.slice(0, -1).reverse()) {
		await input.press("Control+y");
		await expect
			.poll(async () => (await input.innerText()).replace(/\n/g, ""))
			.toBe(expected);
	}
	await expect(input).toHaveText("あ\nい\nう\nえ\nお", {
		useInnerText: true,
	});
	expect(errors).toEqual([]);
});

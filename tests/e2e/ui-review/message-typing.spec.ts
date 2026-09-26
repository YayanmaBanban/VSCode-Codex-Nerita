// 時計を停止して長文の表示期限と項目完了を検証し、各時点を撮影する。
import { test, expect } from "@playwright/test";

test("長文は1.5秒で全文表示し、本文完了では即時にアニメーションを外す", async ({
	page,
}, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	await page.clock.install({ time: new Date("2026-09-17T00:00:00Z") });
	await page.clock.pauseAt(new Date("2026-09-17T00:00:01Z"));
	await page.goto("/iframe.html?id=chat-messages--long-text&viewMode=story");
	const full = "長い回答を確認します。".repeat(30);
	const body = page.locator(".message.assistant .message-text");
	await expect(body).toHaveText(full);
	await page.getByRole("button", { name: "書き込み開始" }).click();
	for (const [name, duration] of [
		["initial", 0],
		["early", 100],
		["middle", 650],
		["late", 700],
		["completed", 50],
	] as const) {
		await page.clock.runFor(duration);
		if (name === "initial") {
			await expect(body).toHaveText("");
		} else if (name === "completed") {
			await expect(body).toHaveText(full);
		} else {
			const visible = await body.innerText();
			expect(visible.length).toBeGreaterThan(0);
			expect(visible.length).toBeLessThan(full.length);
			expect(full.startsWith(visible)).toBe(true);
		}
		await info.attach(name, {
			body: await page.screenshot(),
			contentType: "image/png",
		});
	}
	await page.getByRole("button", { name: "追記", exact: true }).click();
	await expect(body).toHaveText(`${full}追加の本文です。`);
	await page.getByRole("button", { name: "本文完了" }).click();
	await page.getByRole("button", { name: "書き込み開始" }).click();
	await page.clock.runFor(100);
	await page.getByRole("button", { name: "本文完了" }).click();
	await expect(body).toHaveText(`${full}追加の本文です。`);
	expect(errors).toEqual([]);
});

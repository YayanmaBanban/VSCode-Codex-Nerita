// CSS Transition を停止・シークし、開閉途中の高さと操作不可状態を確認する。
import { test, expect } from "@playwright/test";

test("認証アコーディオンの開閉フレームと動きの抑制", async ({ page }, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(
		"/iframe.html?id=chat-piautheditor--providers&viewMode=story",
	);
	const trigger = page.getByRole("button", { name: /Anthropic/ });
	const panel = page.locator("#provider-anthropic");
	await expect(trigger).toBeVisible();
	for (const direction of ["open", "close"]) {
		await trigger.evaluate((button) => {
			const target = document.getElementById("provider-anthropic")!;
			void getComputedStyle(target).gridTemplateRows;
			(button as HTMLButtonElement).click();
		});
		await expect
			.poll(() =>
				panel.evaluate((element) => element.getAnimations().length),
			)
			.toBeGreaterThan(0);
		await panel.evaluate((element) => {
			const animation = element.getAnimations()[0]!;
			animation.pause();
			animation.currentTime = 0;
			(window as unknown as { slide: Animation }).slide = animation;
		});
		const heights: number[] = [];
		for (const [name, time] of [
			["initial", 0],
			["early", 40],
			["middle", 100],
			["late", 160],
			["completed", 200],
		] as const) {
			await page.evaluate((time) => {
				(window as unknown as { slide: Animation }).slide.currentTime =
					time;
			}, time);
			heights.push((await panel.boundingBox())!.height);
			await info.attach(`${direction}-${name}-${time}ms`, {
				body: await page.screenshot({
					path: info.outputPath(`${direction}-${name}.png`),
				}),
				contentType: "image/png",
			});
		}
		if (direction === "open") {
			expect(heights[0]).toBe(0);
			expect(heights[2]).toBeGreaterThan(0);
			expect(heights[2]).toBeLessThan(heights[4]!);
		} else {
			expect(heights[0]).toBeGreaterThan(heights[2]!);
			expect(heights[4]).toBe(0);
			await expect(panel).toHaveAttribute("inert", "");
		}
		await page.evaluate(() =>
			(window as unknown as { slide: Animation }).slide.finish(),
		);
	}
	await page.emulateMedia({ reducedMotion: "reduce" });
	await trigger.click();
	await expect
		.poll(() =>
			panel.evaluate((element) => element.getBoundingClientRect().height),
		)
		.toBeGreaterThan(0);
	expect(
		await panel.evaluate((element) => element.getAnimations().length),
	).toBe(0);
	await trigger.click();
	await expect
		.poll(() =>
			panel.evaluate((element) => element.getBoundingClientRect().height),
		)
		.toBe(0);
	expect(errors).toEqual([]);
});

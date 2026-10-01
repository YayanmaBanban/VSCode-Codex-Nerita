// 権限スライダーのクリックと、時刻を固定した拡大・縮小を確認する。
import {
	test,
	expect,
	type Locator,
	type Page,
	type TestInfo,
} from "@playwright/test";
import { expectSent, showState } from "../storyBridge";
import { settingsFixture } from "../../fixtures/settingsFixture";

/** CSS の遷移を一時停止し、同じ160ミリ秒の区間を決まった時刻で撮影する。 */
async function captureZoom(
	page: Page,
	target: Locator,
	name: string,
	info: TestInfo,
) {
	await expect
		.poll(() =>
			target.evaluate((element) => element.getAnimations().length),
		)
		.toBeGreaterThan(0);
	await target.evaluate((element) => {
		for (const animation of element.getAnimations()) {
			animation.pause();
			animation.effect?.updateTiming({ duration: 160 });
			animation.currentTime = 0;
		}
	});
	for (const time of [0, 40, 80, 120, 160]) {
		await target.evaluate((element, time) => {
			for (const animation of element.getAnimations()) {
				animation.currentTime = time;
			}
		}, time);
		await info.attach(`${name}-${time}ms`, {
			body: await page.screenshot({
				path: info.outputPath(`${name}-${time}.png`),
			}),
			contentType: "image/png",
		});
	}
	await target.evaluate((element) =>
		element.getAnimations().forEach((animation) => animation.finish()),
	);
}

for (const theme of ["dark2026", "light"]) {
	test(`スライダーの拡大とポイント選択: ${theme}`, async ({ page }, info) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		await page.goto(
			`/iframe.html?id=chat-composer-settings--connected&viewMode=story&globals=theme:${theme}`,
		);
		await page.getByRole("button", { name: "Mode", exact: true }).click();
		const slider = page.getByRole("slider", { name: "Mode" });
		const thumb = page.locator(".step-slider-thumb > span");
		const point = page.getByRole("button", {
			name: "Mode: 3",
			exact: true,
		});
		const thumbWidth = (await thumb.boundingBox())!.width;
		const pointWidth = (await point.locator("span").boundingBox())!.width;
		// 自動撮影が始まる前に遷移が完了しないよう、捕捉までの時間だけ延ばす。
		const captureStyle = await page.addStyleTag({
			content:
				".step-slider-thumb > span, .step-slider-point > span { transition-duration: 100000ms; }",
		});
		await slider.hover();
		await captureZoom(page, thumb, "thumb-in", info);
		expect((await thumb.boundingBox())!.width).toBeGreaterThan(thumbWidth);
		await page.mouse.move(0, 0);
		await captureZoom(page, thumb, "thumb-out", info);
		expect((await thumb.boundingBox())!.width).toBeCloseTo(thumbWidth, 1);
		await point.hover();
		await captureZoom(page, point.locator("span"), "point-in", info);
		expect(
			(await point.locator("span").boundingBox())!.width,
		).toBeGreaterThan(pointWidth);
		await page.mouse.move(0, 0);
		await captureZoom(page, point.locator("span"), "point-out", info);
		expect((await point.locator("span").boundingBox())!.width).toBeCloseTo(
			pointWidth,
			1,
		);
		for (const [index, value] of [
			[3, "danger-full-access"],
			[1, "read-only"],
			[2, "workspace-write"],
		] as const) {
			await page
				.getByRole("button", { name: `Mode: ${index}`, exact: true })
				.click();
			await expectSent(page, {
				type: "config/set",
				configId: "mode",
				value,
			});
			await showState(page, {
				configOptions: settingsFixture().map((option) =>
					option.id === "mode"
						? { ...option, currentValue: value }
						: option,
				),
			});
			await expect(slider).toHaveValue(String(index - 1));
		}
		await page.emulateMedia({ reducedMotion: "reduce" });
		await captureStyle.evaluate((element: HTMLStyleElement) => {
			element.remove();
		});
		await expect(thumb).toHaveCSS("transition-duration", "0s");
		await slider.hover();
		expect((await thumb.boundingBox())!.width).toBeGreaterThan(thumbWidth);
		await showState(page, { connection: "disconnected" });
		await expect(slider).toBeDisabled();
		await expect(point).toBeDisabled();
		expect(errors).toEqual([]);
	});
}

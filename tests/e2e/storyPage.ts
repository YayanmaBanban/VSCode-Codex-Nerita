// ブラウザーの明暗設定を Storybook のテーマへ反映し、適用完了を待つ。
import { expect, type Page } from "@playwright/test";

/** `emulateMedia` だけでは変わらない Storybook の色変数を、選択した明暗に揃える。 */
export async function openStory(page: Page, path: string): Promise<void> {
	const light = await page.evaluate(
		() => matchMedia("(prefers-color-scheme: light)").matches,
	);
	const theme = light ? "light" : "dark2026";
	const url = new URL(path, "http://storybook.invalid");
	if (url.searchParams.has("globals")) {
		throw new Error(
			"テーマを明示したストーリーは page.goto で開いてください。",
		);
	}
	url.searchParams.set("globals", `theme:${theme}`);
	await page.goto(`${url.pathname}${url.search}`);
	await expect(page.locator("html")).toHaveAttribute(
		"data-storybook-theme",
		theme,
	);
	await expect(page.locator("html")).toHaveCSS(
		"color-scheme",
		light ? "light" : "dark",
	);
}

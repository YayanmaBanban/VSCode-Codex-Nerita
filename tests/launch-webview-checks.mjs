// 実際の VS Code Webview で CSS の読み込みと設定メニューの表示を確認する。
import { expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";

/** Storybook を経由せず、本体の CSS とポータル表示を検証して記録する。 */
export async function checkLaunchWebview(chat, window, output) {
	const composer = chat.locator(".composer");
	await expect(composer).toHaveCSS("padding", "12px");
	await expect(composer).toHaveCSS("border-radius", "10px");
	await expect(chat.locator(".settings-toolbar")).toHaveCSS(
		"display",
		"flex",
	);
	await expect(
		chat.getByRole("button", { name: "送信", exact: true }),
	).toHaveCSS("width", "32px");
	await expect(chat.getByRole("textbox")).toHaveCSS("min-height", "65px");
	await expect(
		chat.getByRole("button", { name: "送信", exact: true }),
	).toBeDisabled();
	await chat.getByRole("textbox").fill("表示確認");
	await expect(
		chat.getByRole("button", { name: "送信", exact: true }),
	).toBeEnabled();
	await chat.getByRole("textbox").fill("");
	const model = chat.getByRole("combobox", { name: "Model", exact: true });
	await expect(model).toBeEnabled();
	await model.click();
	const popup = chat.locator(".config-popup");
	await expect(popup).toBeVisible();
	await expect(popup).toHaveCSS("border-radius", "8px");
	await expect(chat.getByRole("option").first()).toHaveCSS(
		"font-size",
		"12px",
	);
	await expect(chat.locator(".config-check")).toHaveCount(1);
	await window.screenshot({ path: path.join(output, "model-menu.png") });
	const metrics = await chat.evaluate(() => {
		/** 寸法と配色を記録し、本文や認証情報を収集しない。 */
		const inspect = (selector) => {
			const element = globalThis.document.querySelector(selector);
			const style = globalThis.getComputedStyle(element);
			const box = element.getBoundingClientRect();
			return {
				width: box.width,
				height: box.height,
				padding: style.padding,
				background: style.backgroundColor,
				color: style.color,
				borderRadius: style.borderRadius,
			};
		};
		return {
			theme: globalThis.document.body.getAttribute(
				"data-vscode-theme-kind",
			),
			composer: inspect(".composer"),
			menu: inspect(".config-popup"),
			viewportWidth: globalThis.innerWidth,
			scrollWidth: globalThis.document.documentElement.scrollWidth,
		};
	});
	expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);
	await writeFile(
		path.join(output, "webview-metrics.json"),
		JSON.stringify(metrics, null, 2),
	);
	// メニュー内の現在のフォーカスへ送り、トリガーへフォーカスを戻さない。
	await window.keyboard.press("Escape");
	await expect(model).toHaveAttribute("aria-expanded", "false");
	await expect(popup).toBeHidden();
	console.log(
		"Webview: Tailwind dimensions, input state and model menu verified",
	);
}

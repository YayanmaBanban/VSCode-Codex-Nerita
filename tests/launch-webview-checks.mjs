// 実際の VS Code Webview で入力と設定メニューの操作・画面内表示を確認する。
import { expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";

/** Storybook を経由せず、本体の CSS とポータル表示を検証して記録する。 */
export async function checkLaunchWebview(chat, window, output) {
	await expect(
		chat.getByRole("button", { name: "送信", exact: true }),
	).toBeInViewport();
	await expect(chat.getByRole("textbox")).toBeInViewport();
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
	const popup = chat.getByRole("listbox");
	await expect(popup).toBeVisible();
	await expect(chat.getByRole("option", { selected: true })).toHaveCount(1);
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
	console.log("Webview: viewport, input state and model menu verified");
}

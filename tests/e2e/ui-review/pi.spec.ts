// Pi の送信契約と、独立した実行状態の表示を確認する。
import { test, expect } from "@playwright/test";
import { piState } from "../../../src/stories/chat/fixtures/pi";
import { expectSent, showState, acceptPrompt } from "../storyBridge";

test("Pi の送信・停止要求と表示状態", async ({ page }, info) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("/iframe.html?id=chat-app--pi&viewMode=story");
	await page.getByRole("textbox").fill("ファイルを確認してください");
	await page.getByRole("button", { name: "送信", exact: true }).click();
	await expectSent(page, {
		type: "prompt/send",
		text: "ファイルを確認してください",
		sessionId: "pi-story",
	});
	await acceptPrompt(page);
	await showState(page, piState("running"));
	await expect(page.getByText(/Piからの応答/)).toBeVisible();
	await page.screenshot({ path: info.outputPath("pi-streaming.png") });
	await page.getByRole("button", { name: "停止", exact: true }).click();
	await expectSent(page, {
		type: "prompt/cancel",
		runId: "pi-story-run",
		sessionId: "pi-story",
	});
	await showState(page, piState("cancelled"));
	await expect(page.getByText("停止しました", { exact: true })).toBeVisible();
	await page.screenshot({ path: info.outputPath("pi-stopped.png") });
	await showState(page, piState("completed"));
	await expect(page.getByRole("progressbar")).toHaveAttribute(
		"aria-valuenow",
		"60000",
	);
	await page.screenshot({ path: info.outputPath("pi-completed.png") });
	await page.getByRole("button", { name: "新しいチャット" }).click();
	await expectSent(page, { type: "session/new" });
	expect(errors).toEqual([]);
});

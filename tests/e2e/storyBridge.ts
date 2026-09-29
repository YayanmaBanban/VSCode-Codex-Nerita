// Storybook の通信境界を観測し、テストが指定した Host 応答だけを注入する。
import { expect, type Page } from "@playwright/test";
import type { ChatState } from "@nerita/shared/chatState";
import type { HostMessage, UiMessage } from "@nerita/shared/messages";
import type { StoryBridge } from "../../apps/nerita-ui/stories/chat/mocks/storyBridge";

/** 実 UI が送信したメッセージを取得する。 */
export async function sentMessages(page: Page): Promise<UiMessage[]> {
	return page
		.locator("[data-story-chat]")
		.evaluate(
			(element) =>
				(element as HTMLElement & { storyBridge: StoryBridge })
					.storyBridge.sent,
		);
}

/** 操作の契約を検証し、実際の要求 ID を必要な応答へ渡す。 */
export async function expectSent(page: Page, message: Partial<UiMessage>) {
	await expect
		.poll(() => sentMessages(page))
		.toContainEqual(expect.objectContaining(message));
	const sent = await sentMessages(page);
	return [...sent]
		.reverse()
		.find((item) =>
			Object.entries(message).every(
				([key, value]) =>
					JSON.stringify(item[key as keyof UiMessage]) ===
					JSON.stringify(value),
			),
		)!;
}

/** 指定されたイベントをそのまま配信する。 */
export async function emitHost(page: Page, message: HostMessage) {
	await page
		.locator("[data-story-chat]")
		.evaluate(
			(element, event) =>
				(
					element as HTMLElement & { storyBridge: StoryBridge }
				).storyBridge.emit(event),
			message,
		);
}

/** 表示状態を明示的に切り替える。操作から次状態は計算しない。 */
export async function showState(page: Page, patch: Partial<ChatState>) {
	await page
		.locator("[data-story-chat]")
		.evaluate(
			(element, changes) =>
				(
					element as HTMLElement & { storyBridge: StoryBridge }
				).storyBridge.patchState(changes),
			patch,
		);
}

/** 受付通知だけを注入する。会話や実行状態は生成しない。 */
export async function acceptPrompt(
	page: Page,
	mode: "start" | "steer" = "start",
) {
	const message = (await sentMessages(page))
		.reverse()
		.find((item) => item.type === "prompt/send");
	if (!message || message.type !== "prompt/send") {
		throw new Error("No prompt was sent");
	}
	await emitHost(page, {
		type: "prompt/accepted",
		requestId: message.requestId,
		mode,
	});
}

/** UI が保存要求した下書きを、新しい表示先からの復元通知として往復させる。 */
export async function restoreDraft(page: Page, editor: boolean) {
	await expectSent(page, {
		type: editor ? "ui/openEditor" : "ui/openSidebar",
	});
	const message = await expectSent(page, { type: "ui/saveDraft" });
	if (message.type !== "ui/saveDraft") {
		throw new Error("No draft was sent");
	}
	// 現在の描画を消してから復元し、既存のチップが残っただけの成功を防ぐ。
	await page.getByRole("textbox", { name: "Codexへのメッセージ" }).fill("");
	await emitHost(page, {
		type: "ui/viewState",
		editor,
		draft: message.draft,
		draftParts: message.draftParts,
		scrollTop: 0,
		restoreScroll: true,
	});
}

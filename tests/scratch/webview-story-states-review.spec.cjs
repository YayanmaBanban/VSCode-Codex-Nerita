// ケースの選択実行: pnpm test:scratch webview-story-states-review.spec.cjs --grep "ケース名"
// 操作テストとは別に、確認対象を残した各状態を明暗テーマ・狭い幅で撮影する。
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { test } = require("../support/scratch-test.cjs");

const groups = {
	"agent-manager-states": [
		"many-pi-agents",
		"many-codex-agents",
		"invalid-name",
		"read-only-agent",
		"unsupported-agent",
		"inherited-agent",
		"saving-agent",
		"codex-unsupported-effort",
		"handoff-unsupported-effort",
		"handoff-unknown-model",
		"handoff-no-models",
		"handoff-save-error",
		"unsaved-navigation",
	],
	"agent-manager-footer": ["hidden", "unsaved", "disabled"],
	"agent-manager-handoff-models": [
		"model-update-while-editing",
		"pi-unspecified-model",
		"codex-current",
		"pi-current",
		"codex-fixed",
		"pi-fixed",
		"pi-without-preferred-model",
		"no-models",
		"current-unavailable",
	],
	"agent-manager": [
		"backend-switch",
		"invalid-handoff",
		"load-errors",
		"save-error",
	],
	"pi-credentials": [
		"existing-binding",
		"environment-injection",
		"host-error",
		"operation-notice",
		"busy",
		"invalid-binding",
	],
	"pi-guardrails": [
		"loading",
		"invalid-json",
		"save-error",
		"inspection-error",
		"edit-conflict",
		"inspection-result",
	],
	"pi-sandbox": ["loading", "empty", "busy", "host-error"],
	"pi-workflow": ["loading", "running", "save-error", "validation-error"],
	"trust-manager": ["empty", "loading", "host-error", "no-search-results"],
	"chat-personality": [
		"configured",
		"loading",
		"load-error",
		"name-collision",
	],
	"chat-piautheditor": [
		"option-prompt",
		"configured",
		"cancelled",
		"provider-error",
		"no-providers",
	],
	"chat-questions": ["validation-error", "host-error"],
	"chat-agents": ["viewer-loading", "viewer-error", "viewer-empty"],
	"chat-mcp-message": ["loading", "error", "empty", "server-states"],
	"chat-search": ["invalid-regex", "no-results"],
	"chat-sessions": [
		"paginated",
		"empty",
		"error",
		"unsupported",
		"loading",
		"rename",
		"delete-confirmation",
		"archived",
	],
	"chat-composer-symbols": ["search", "search-error", "no-results"],
	"chat-composer-menu": ["no-command-matches"],
	"chat-tool-cards": ["output-loading", "output-error"],
	"chat-app": ["attachment-drop-active", "attachment-limit-error"],
};

/** ストーリーの操作完了と有限の表示遷移を待ち、状態を変えずに撮影する。 */
async function capture(page, id, theme, width, directory) {
	await page.setViewportSize({ width, height: 800 });
	await page.goto(
		`http://localhost:6006/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`,
	);
	await page.waitForFunction(
		() =>
			globalThis.__STORYBOOK_PREVIEW__?.currentRender?.phase ===
			"finished",
	);
	await page.evaluate(async () => {
		await Promise.allSettled(
			globalThis.document
				.getAnimations()
				.filter(
					(animation) =>
						animation.effect?.getTiming().iterations !== Infinity,
				)
				.map((animation) => animation.finished),
		);
	});
	assert.equal(await page.locator(".sb-errordisplay").isVisible(), false, id);
	const feedback =
		!id.startsWith("chat-composer-symbols") &&
		[
			"error",
			"conflict",
			"invalid-name",
			"unsupported-effort",
			"invalid-json",
			"invalid-binding",
		].some((value) => id.includes(value));
	if (feedback) {
		assert.ok(
			(await page.getByRole("alert").count()) > 0,
			`${id}: 確認対象のエラーを残す`,
		);
	}
	await page.screenshot({
		path: `${directory}/${id}-${theme}-${width}.png`,
		fullPage: true,
	});
	return page.evaluate(() => ({
		width: globalThis.innerWidth,
		background: globalThis.getComputedStyle(globalThis.document.body)
			.backgroundColor,
		foreground: globalThis.getComputedStyle(globalThis.document.body).color,
		alerts: [...globalThis.document.querySelectorAll('[role="alert"]')].map(
			(element) => element.textContent,
		),
	}));
}

const cases = [];
for (const [group, states] of Object.entries(groups)) {
	for (const state of states) {
		for (const theme of ["dark2026", "light"]) {
			cases.push({ id: `${group}--${state}`, theme, width: 420 });
		}
	}
}
cases.push(
	...[
		"pi-guardrails--edit-conflict",
		"pi-workflow--save-error",
		"agent-manager-states--unsaved-navigation",
	].map((id) => ({ id, theme: "light", width: 1280 })),
);
for (const { id, theme, width } of cases) {
	test(`表示状態: ${id} ${theme} ${width} @visual`, async ({
		reviewBrowser: browser,
	}, testInfo) => {
		const directory = testInfo.outputPath("review");
		await fs.mkdir(directory, { recursive: true });
		const page = await browser.newPage();
		page.setDefaultTimeout(10000);
		page.setDefaultNavigationTimeout(60000);
		const result = await capture(page, id, theme, width, directory);
		await fs.writeFile(
			`${directory}/results.json`,
			JSON.stringify({ id, theme, width, ...result }, null, 2),
		);
	});
}

// 元の表示状態と操作アサーションを Svelte UI へ移行する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, spyOn, userEvent, within, waitFor } from "storybook/test";
import { storyBridge } from "../storyBridgeElement";
import { respondToolOutput } from "./ToolCardData";
import ToolCardToolCardsStory from "./ToolCardToolCardsStory.svelte";
import ToolCardExample1 from "./ToolCardExample1.svelte";
import ToolCardExample2 from "./ToolCardExample2.svelte";
import ToolCardExample3 from "./ToolCardExample3.svelte";
import ToolCardExample4 from "./ToolCardExample4.svelte";
import ToolCardExample5 from "./ToolCardExample5.svelte";
import ToolCardExample6 from "./ToolCardExample6.svelte";
import ToolCardExample7 from "./ToolCardExample7.svelte";

const meta = {
	title: "Chat/Tool Cards",
	/** 開いた状態の見本も残しつつ、次の検証へモーダルの操作制限を持ち越さない。 */
	beforeEach: () => async () => {
		const close = within(document.body).queryByRole("button", {
			name: "詳細出力を閉じる",
		});
		if (close) {
			await userEvent.click(close);
		}
		await waitFor(() =>
			expect(document.body.style.pointerEvents).not.toBe("none"),
		);
	},
	component: ToolCardToolCardsStory,
	argTypes: { background: { control: "boolean" } },
	parameters: {
		layout: "fullscreen",
		controls: { matchers: { color: /Color$/i } },
	},
} satisfies Meta<typeof ToolCardToolCardsStory>;
export default meta;
type Story = StoryObj<{ background?: boolean; commands?: boolean }>;
export const Running: Story = {};
export const Background: Story = { args: { background: true } };
export const CommandTitles: Story = { args: { commands: true } };
export const LongCommandTooltip: StoryObj<typeof ToolCardExample1> = {
	render: () => ({ Component: ToolCardExample1 }),
};
export const CompletionPreservesExpansion: Story = {
	args: { commands: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const codex = canvas.getByRole("button", {
			name: /^Get-Content/,
			expanded: false,
		});
		const pi = canvas.getByRole("button", {
			name: /^Get-Location/,
			expanded: false,
		});
		const closed = canvas.getByRole("button", {
			name: /^pnpm.cmd check/,
			expanded: false,
		});
		await userEvent.click(codex);
		await userEvent.click(pi);
		await expect(codex).toHaveAttribute("aria-expanded", "true");
		await expect(pi).toHaveAttribute("aria-expanded", "true");
		await userEvent.click(
			canvas.getByRole("button", { name: "完了通知を受信" }),
		);
		await waitFor(async () => {
			await expect(codex).toHaveAttribute("aria-expanded", "true");
			await expect(pi).toHaveAttribute("aria-expanded", "true");
			await expect(closed).toHaveAttribute("aria-expanded", "false");
		});
		await expect(canvas.getAllByRole("img", { name: "完了" })).toHaveLength(
			3,
		);
		await userEvent.click(codex);
		await expect(codex).toHaveAttribute("aria-expanded", "false");
	},
};
export const ClosedBodiesReleased: StoryObj<typeof ToolCardExample2> = {
	render: () => ({ Component: ToolCardExample2 }),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		for (const name of ["差分の遅延表示", "推論の遅延表示"]) {
			const heading = canvas.getByRole("button", {
				name: new RegExp(`^${name}`),
			});
			const body = () =>
				name === "差分の遅延表示"
					? canvas.queryByRole("region", {
							name: "lazy.txt の差分",
							hidden: true,
						})
					: canvas.queryByText("推論の本文");
			await expect(body()).not.toBeInTheDocument();
			await userEvent.click(heading);
			await waitFor(() => expect(body()).toBeVisible());
			await userEvent.click(heading);
			await waitFor(() => expect(body()).not.toBeInTheDocument());

			await userEvent.click(heading);
			await waitFor(() => expect(body()).toBeVisible());
			await userEvent.click(heading);
			await userEvent.click(heading);
			const collapse = document.getElementById(
				heading.getAttribute("aria-controls")!,
			);
			await Promise.allSettled(
				collapse!
					.getAnimations()
					.map((animation) => animation.finished),
			);
			await expect(heading).toHaveAttribute("aria-expanded", "true");
			await expect(body()).toBeVisible();
			await userEvent.click(heading);
			await waitFor(() => expect(body()).not.toBeInTheDocument());
		}
	},
};
export const ScrollExpansion: StoryObj<typeof ToolCardExample3> = {
	render: () => ({ Component: ToolCardExample3 }),
};
export const LargeOutput: StoryObj<typeof ToolCardExample4> = {
	render: () => ({ Component: ToolCardExample4 }),
};
export const OutputLoading: StoryObj<typeof ToolCardExample5> = {
	render: () => ({ Component: ToolCardExample5 }),
	play: openOutput,
};
export const OutputError: StoryObj<typeof ToolCardExample5> = {
	render: () => ({ Component: ToolCardExample5 }),
	play: async (context) => {
		await openOutput(context);
		const { canvasElement } = context;
		respondToolOutput(storyBridge(canvasElement), true);
		await waitFor(() =>
			expect(
				within(canvasElement.ownerDocument.body).getByRole("alert"),
			).toBeVisible(),
		);
		await expect(
			within(canvasElement.ownerDocument.body).getByRole("button", {
				name: "次の範囲を表示",
			}),
		).toBeDisabled();
	},
};

/** 読み込み中の詳細を残し、応答ボタンで成功・失敗を選べるようにする。 */
async function openOutput({ canvasElement }: { canvasElement: HTMLElement }) {
	const canvas = within(canvasElement);
	await userEvent.click(
		canvas.getByRole("button", { name: /^Get-Content/, expanded: false }),
	);
	await userEvent.click(canvas.getByRole("button", { name: "詳細出力" }));
	await expect(
		within(canvasElement.ownerDocument.body).getByRole("region", {
			name: "詳細出力",
		}),
	).toHaveAttribute("aria-busy", "true");
}
export const OutputControls: StoryObj<typeof ToolCardExample5> = {
	render: () => ({ Component: ToolCardExample5 }),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const copy = spyOn(navigator.clipboard, "writeText").mockResolvedValue(
			undefined,
		);
		try {
			await userEvent.click(
				canvas.getByRole("button", {
					name: /^Get-Content/,
					expanded: false,
				}),
			);
			await userEvent.click(
				canvas.getByRole("button", { name: "出力をコピー" }),
			);
			await expect(copy).toHaveBeenLastCalledWith(
				"出力開始\nChecking types...\n\n… 18,420文字を省略 …\n\nFAIL: 末尾エラー",
			);
			const disclosure = canvas.getByRole("button", { name: "詳細出力" });
			await userEvent.click(disclosure);
			const detail = await within(
				canvasElement.ownerDocument.body,
			).findByRole("region", { name: "詳細出力" });
			const range = within(detail);
			const copyButton = range.getByRole("button", {
				name: "出力をコピー",
			});
			const previous = range.getByRole("button", {
				name: "前の範囲を表示",
			});
			const next = range.getByRole("button", { name: "次の範囲を表示" });
			await expect(copyButton).toBeDisabled();
			await expect(previous).toBeDisabled();
			respondToolOutput(storyBridge(canvasElement));
			await userEvent.click(copyButton);
			await expect(copy).toHaveBeenLastCalledWith(
				"先頭の詳細出力\n日本語と絵文字 🐈\n".repeat(1000),
			);
			await userEvent.click(next);
			respondToolOutput(storyBridge(canvasElement));
			await expect(next).toBeDisabled();
			await userEvent.click(copyButton);
			await expect(copy).toHaveBeenLastCalledWith(
				"次の詳細出力\nFAIL: 末尾エラー",
			);
			await userEvent.click(previous);
			respondToolOutput(storyBridge(canvasElement));
			await expect(previous).toBeDisabled();
			copy.mockRejectedValueOnce(new Error("clipboard unavailable"));
			await userEvent.click(copyButton);
			await expect(copyButton).toHaveAttribute(
				"data-copy-result",
				"error",
			);
			await userEvent.click(copyButton);
			await expect(copyButton).toHaveAttribute(
				"data-copy-result",
				"success",
			);
			await userEvent.click(
				within(canvasElement.ownerDocument.body).getByRole("button", {
					name: "詳細出力を閉じる",
				}),
			);
			await expect(
				within(canvasElement.ownerDocument.body).queryByRole("region", {
					name: "詳細出力",
				}),
			).not.toBeInTheDocument();
			await expect(disclosure).toHaveAttribute("aria-expanded", "false");
			await expect(disclosure).toHaveFocus();
			await waitFor(() =>
				expect(document.body.style.pointerEvents).not.toBe("none"),
			);
			await verifyClosedOutputReset(canvasElement);
		} finally {
			copy.mockRestore();
		}
	},
};
export const StructuredResult: StoryObj<typeof ToolCardExample6> = {
	render: () => ({ Component: ToolCardExample6 }),
};
export const UnknownResult: StoryObj<typeof ToolCardExample7> = {
	render: () => ({ Component: ToolCardExample7 }),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByText("結果不明", { exact: true }),
		).toBeVisible();
		await userEvent.click(
			canvas.getByRole("button", {
				name: /^遠隔の項目を更新/,
				expanded: false,
			}),
		);
		await waitFor(async () => {
			await expect(
				canvas.getByText(/遠隔処理が完了した可能性/),
			).toBeVisible();
		});
		await expect(
			canvas.queryByRole("button", { name: /再実行|停止/ }),
		).not.toBeInTheDocument();
	},
};

/** 閉じたカードの取得済み本文を解放し、再表示を初期状態へ戻す。 */
async function verifyClosedOutputReset(canvasElement: HTMLElement) {
	const canvas = within(canvasElement);
	const heading = canvas.getByRole("button", {
		name: /^Get-Content/,
		expanded: true,
	});
	await userEvent.click(canvas.getByRole("button", { name: "詳細出力" }));
	respondToolOutput(storyBridge(canvasElement));
	await userEvent.click(
		within(canvasElement.ownerDocument.body).getByRole("button", {
			name: "詳細出力を閉じる",
		}),
	);
	await waitFor(() =>
		expect(document.body.style.pointerEvents).not.toBe("none"),
	);
	await userEvent.click(heading);
	await waitFor(() =>
		expect(
			within(canvasElement.ownerDocument.body).queryByRole("region", {
				name: "詳細出力",
			}),
		).not.toBeInTheDocument(),
	);
	await userEvent.click(heading);
	await expect(
		canvas.getByRole("button", { name: "詳細出力" }),
	).toHaveAttribute("aria-expanded", "false");
	await expect(canvas.queryByText(/先頭の詳細出力/)).not.toBeInTheDocument();
}

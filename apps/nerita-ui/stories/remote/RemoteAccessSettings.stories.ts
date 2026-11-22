// PC 側のリモート設定と、ペアリング成功による自動クローズを確認する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import Preview from "./RemoteAccessSettingsPreview.svelte";

const meta = { title: "Remote/PC Settings", component: Preview } satisfies Meta<
	typeof Preview
>;
export default meta;
type Story = StoryObj<typeof meta>;

/** 表示された残り時間が、同じ受付期限に向かって減ることを確認する。 */
async function verifyPairingDetails(dialog: HTMLElement) {
	const bar = within(dialog).getByRole("progressbar", {
		name: "ペアリングコードの残り時間",
	});
	const url = within(dialog).getByText("https://remote.example.ts.net/");
	await expect(url.getBoundingClientRect().width).toBe(
		bar.getBoundingClientRect().width,
	);
	await expect(bar).toHaveAttribute("max", "120");
	await waitFor(
		() => expect(Number(bar.getAttribute("value"))).toBeLessThan(120),
		{ timeout: 2200 },
	);
}

/** 接続中の操作と、端末を切断した直後の表示を確認する。 */
async function verifyDisconnect(cardElement: HTMLElement) {
	const card = within(cardElement);
	await expect(card.getByRole("status")).toHaveTextContent("接続中");
	await expect(
		card.queryByRole("button", { name: "ペアリングコードを表示" }),
	).not.toBeInTheDocument();
	await userEvent.click(
		card.getByRole("button", { name: "リモート端末を切断" }),
	);
	await expect(card.getByRole("status")).toHaveTextContent("接続待ち");
}

export const Idle: Story = {};

export const AccessLifecycle: Story = {
	name: "開始・ペアリング・停止",
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		const view = canvasElement.ownerDocument.defaultView;
		await expect(view).not.toBeNull();
		const trigger = canvas.getByRole("button", {
			name: "リモートアクセス",
		});
		await userEvent.click(trigger);
		const card = await page.findByRole("dialog", {
			name: "リモートアクセス設定",
		});
		const controls = within(card);
		const fqdn = controls.getByLabelText("接続先");
		await expect(fqdn).toHaveValue("desktop.example.ts.net");
		await userEvent.clear(fqdn);
		await userEvent.type(fqdn, "remote.example.ts.net");
		await userEvent.click(controls.getByRole("switch"));
		const dialog = await page.findByRole("alertdialog", {
			name: "リモートアクセス",
		});
		await expect(dialog).toHaveTextContent("12345678");
		await verifyPairingDetails(dialog);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "閉じる" }),
		);
		await waitFor(() =>
			expect(page.queryByRole("alertdialog")).not.toBeInTheDocument(),
		);
		await waitFor(() =>
			expect(view?.getComputedStyle(trigger).pointerEvents).toBe("auto"),
		);
		await userEvent.click(trigger);
		const openCard = within(
			await page.findByRole("dialog", { name: "リモートアクセス設定" }),
		);
		await expect(openCard.getByRole("switch")).toBeChecked();
		await expect(openCard.getByRole("status")).toHaveTextContent(
			"接続待ち",
		);
		await expect(
			openCard.queryByRole("button", { name: "リモート端末を切断" }),
		).not.toBeInTheDocument();
		await expect(
			trigger.querySelector(".lucide-monitor-activity"),
		).toBeInTheDocument();
		await userEvent.click(
			openCard.getByRole("button", { name: "ペアリングコードを表示" }),
		);
		await page.findByRole("alertdialog", { name: "リモートアクセス" });
		canvasElement.ownerDocument.dispatchEvent(
			new Event("storybook:remote-paired"),
		);
		await waitFor(() =>
			expect(page.queryByRole("alertdialog")).not.toBeInTheDocument(),
		);
		await expect(
			trigger.querySelector(".lucide-monitor-check"),
		).toBeInTheDocument();
		await waitFor(() =>
			expect(view?.getComputedStyle(trigger).pointerEvents).toBe("auto"),
		);
		await expect(trigger).toHaveFocus();
		await userEvent.click(trigger);
		const activeCardElement = await page.findByRole("dialog", {
			name: "リモートアクセス設定",
		});
		await verifyDisconnect(activeCardElement);
		const activeCard = within(activeCardElement);
		await userEvent.click(activeCard.getByRole("switch"));
		await expect(activeCard.getByRole("switch")).not.toBeChecked();
	},
};

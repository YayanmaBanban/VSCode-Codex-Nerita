// Host の公開状態と送信要求を検証し、保存成功をストーリー側で生成しない。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import CredentialEditor from "../../src/pi/CredentialEditor.svelte";

const meta = {
	title: "Pi/Credentials",
	component: CredentialEditor,
	parameters: { layout: "fullscreen" },
	args: {
		send: fn(),
		state: {
			type: "state",
			busy: false,
			bindings: [],
			providers: [
				{
					id: "git",
					available: true,
					authenticated: false,
					mode: null,
				},
				{
					id: "npmrc",
					available: true,
					authenticated: false,
					mode: null,
				},
				{
					id: "bitwarden-secrets-manager",
					available: true,
					authenticated: true,
					mode: "secret-storage",
				},
			],
		},
	},
} satisfies Meta<typeof CredentialEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const ExistingBinding: Story = {
	args: {
		state: {
			...meta.args.state,
			bindings: [
				{
					id: "packages",
					match: {
						kind: "npm-registry",
						target: "npm.pkg.github.com",
					},
					provider: { type: "npmrc" },
					injection: { type: "npm-auth-token" },
				},
			],
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "編集" }));
		await expect(
			canvas.getByRole("textbox", { name: "Binding ID" }),
		).toBeDisabled();
		await expect(
			canvas.getByRole("textbox", { name: "Binding ID" }),
		).toHaveValue("packages");
	},
};
export const EnvironmentInjection: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.selectOptions(
			canvas.getByRole("combobox", { name: "用途" }),
			"api-token",
		);
		await expect(
			canvas.getByRole("textbox", { name: "注入先の環境変数名" }),
		).toBeVisible();
	},
};
export const HostError: Story = {
	args: {
		error: "資格情報の保存に失敗しました。設定を確認して再試行してください。",
	},
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByRole("alert")).toBeVisible();
	},
};
export const OperationNotice: Story = {
	args: { notice: "資格情報の参照を更新しました。" },
};
export const Busy: Story = {
	args: { state: { ...meta.args.state, busy: true } },
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByRole("button", {
				name: "Binding を保存",
			}),
		).toBeDisabled();
	},
};
export const InvalidBinding: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "Binding ID" }),
			" ",
		);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "対象" }),
			"npm.pkg.github.com",
		);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "シークレット ID" }),
			"fixture-secret",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "Binding を保存" }),
		);
		await expect(canvas.getByRole("alert")).toBeVisible();
		await expect(args.send).not.toHaveBeenCalled();
	},
};
export const SaveBinding: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			canvas.getByLabelText("Binding ID"),
			"github-packages",
		);
		await userEvent.type(
			canvas.getByLabelText("対象"),
			"npm.pkg.github.com",
		);
		await userEvent.type(
			canvas.getByLabelText("シークレット ID"),
			"2863ced6-eba1-48b4-b5c0-afa30104877a",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "Binding を保存" }),
		);
		await expect(args.send).toHaveBeenLastCalledWith({
			type: "save-binding",
			binding: {
				id: "github-packages",
				match: { kind: "npm-registry", target: "npm.pkg.github.com" },
				provider: {
					type: "bitwarden-secrets-manager",
					secretId: "2863ced6-eba1-48b4-b5c0-afa30104877a",
					accountId: "default",
				},
				injection: { type: "npm-auth-token" },
			},
		});
		await expect(
			canvas.getByRole("button", { name: "Binding を保存" }),
		).toBeEnabled();
	},
};

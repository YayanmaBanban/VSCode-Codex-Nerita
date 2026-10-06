// Host の公開状態と送信要求を検証し、保存成功をストーリー側で生成しない。
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CredentialEditor } from "../../src/pi/CredentialSettings";

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

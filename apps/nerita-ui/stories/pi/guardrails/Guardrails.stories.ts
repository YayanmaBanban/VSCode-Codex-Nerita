// 既存の画面状態を Svelte コンポーネントで検証する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import GuardrailsPreview from "./GuardrailsPreview.svelte";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { guardrailsConfigSchema } from "@nerita/shared/guardrails/config";

const meta = {
	title: "Pi/Guardrails",
	component: GuardrailsPreview,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof GuardrailsPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Editor: Story = {};
export const BuiltinSwitches: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "組み込み" }));
		const ssh = canvas.getByRole("switch", {
			name: "SSH・秘密鍵を承認にする",
		});
		await expect(ssh).not.toBeChecked();
		await userEvent.click(ssh);
		await expect(ssh).toBeChecked();
		const git = canvas.getByRole("switch", {
			name: "Git の破壊的操作を承認にする",
		});
		await expect(git).toBeChecked();
		await userEvent.click(git);
		await expect(git).not.toBeChecked();
		await userEvent.click(canvas.getByRole("button", { name: "JSON" }));
		const json = canvas.getByRole<HTMLTextAreaElement>("textbox", {
			name: "設定JSON",
		});
		const config = guardrailsConfigSchema.parse(JSON.parse(json.value));
		await expect(config.builtins.paths.ssh).toBe("ask");
		await expect(config.builtins.commands.git).toBe("deny");
		await userEvent.click(
			canvas.getByRole("button", { name: "保存して適用" }),
		);
	},
};
export const SwitchPathMatch: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const menu = within(canvasElement.ownerDocument.body);
		for (const name of [
			"ディレクトリ配下",
			"Glob",
			"ディレクトリ配下",
			"Glob",
		]) {
			await userEvent.click(
				canvas.getByRole("combobox", { name: "照合" }),
			);
			await userEvent.click(await menu.findByRole("option", { name }));
			await expect(
				canvas.getByRole("combobox", { name: "照合" }),
			).toHaveTextContent(name);
		}
	},
};
export const Loading: Story = { args: { loading: true } };
export const InvalidJson: Story = {
	args: { invalid: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const alert = await canvas.findByRole("alert");
		await expect(alert).toBeVisible();
		alert.scrollIntoView({ block: "nearest" });
		await expect(
			canvas.getByRole("textbox", { name: "設定JSON" }),
		).toHaveValue("{ invalid JSON");
	},
};
export const SaveError: Story = {
	args: { failure: "save" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "保存して適用" }),
		);
		await expect(await canvas.findByRole("alert")).toBeVisible();
		canvas.getByRole("alert").scrollIntoView({ block: "nearest" });
	},
};
export const InspectionError: Story = {
	args: { failure: "check" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const simulation = canvas.queryByRole("button", {
			name: "シミュレーション",
		});
		if (simulation !== null && simulation.getClientRects().length > 0) {
			await userEvent.click(simulation);
		}
		await userEvent.click(
			await canvas.findByRole("button", { name: "検査" }),
		);
		await expect(await canvas.findByRole("alert")).toBeVisible();
		canvas.getByRole("alert").scrollIntoView({ block: "nearest" });
	},
};
export const EditConflict: Story = {
	args: { failure: "edit" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "JSON" }),
		);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "設定JSON" }),
			" ",
		);
		await expect(await canvas.findByRole("alert")).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "編集を破棄して再読込" }),
		).toBeEnabled();
		canvas
			.getByRole("button", { name: "編集を破棄して再読込" })
			.scrollIntoView({ block: "nearest" });
		canvas.getByRole("alert").scrollIntoView({ block: "nearest" });
	},
};
export const InspectionResult: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const simulation = canvas.queryByRole("button", {
			name: "シミュレーション",
		});
		if (simulation !== null && simulation.getClientRects().length > 0) {
			await userEvent.click(simulation);
		}
		await userEvent.click(
			await within(canvasElement).findByRole("button", { name: "検査" }),
		);
	},
};

export const RuleSelection: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await within(
				canvas.getByRole("navigation", { name: "ルールのカテゴリ" }),
			).findByRole("button", { name: /パスルール/ }),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: /ルールを追加/ }),
		);
		const id = canvas.getByRole("textbox", { name: "ID" });
		await userEvent.clear(id);
		await userEvent.type(id, "second-path");
		await expect(
			canvas.getByRole("heading", { name: "second-path" }),
		).toBeVisible();
		await userEvent.click(
			within(
				canvas.getByRole("navigation", { name: "ルールのカテゴリ" }),
			).getByRole("button", { name: /例外/ }),
		);
		await expect(
			canvas.getByRole("heading", { name: "second-path" }),
		).toBeVisible();
		await userEvent.click(
			within(
				canvas.getByRole("navigation", { name: "ルールのカテゴリ" }),
			).getByRole("button", { name: /パスルール/ }),
		);
		await expect(canvas.getByRole("textbox", { name: "ID" })).toHaveValue(
			"second-path",
		);
		await userEvent.click(canvas.getByRole("button", { name: "JSON" }));
		const json = canvas.getByRole<HTMLTextAreaElement>("textbox", {
			name: "設定JSON",
		});
		const config = guardrailsConfigSchema.parse(JSON.parse(json.value));
		await expect(config.pathRules.map((rule) => rule.id)).toEqual([
			"env-files",
			"second-path",
		]);
		await userEvent.click(
			within(
				canvas.getByRole("navigation", { name: "ルールのカテゴリ" }),
			).getByRole("button", { name: /パスルール/ }),
		);
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "保存して適用" }),
			).toBeEnabled(),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "保存して適用" }),
		);
		await expect(canvasElement.querySelector("main")).toHaveAttribute(
			"data-document-status",
			"適用済み",
		);
	},
};

export const HoldPathDeletion: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: /ルールを追加/ }),
		);
		const id = canvas.getByRole("textbox", { name: "ID" });
		await userEvent.clear(id);
		await userEvent.type(id, "second-path");
		await userEvent.click(
			canvas.getByRole("combobox", { name: "パスルールを選択" }),
		);
		await userEvent.click(
			within(canvasElement.ownerDocument.body).getByRole("option", {
				name: "env-files",
			}),
		);
		const deletion = canvas.getByRole("button", {
			name: "パスルール 1を削除",
		});
		await userEvent.click(deletion);
		await expect(canvas.getByRole("textbox", { name: "ID" })).toHaveValue(
			"env-files",
		);
		await expect(
			canvas.getByRole("heading", { name: "env-files" }),
		).toBeVisible();
		deletion.focus();
		await userEvent.keyboard("{Enter>}");
		await waitFor(
			() =>
				expect(canvas.getByRole("textbox", { name: "ID" })).toHaveValue(
					"second-path",
				),
			{ timeout: 4000 },
		);
		await userEvent.keyboard("{/Enter}");
		await expect(canvas.getByRole("textbox", { name: "ID" })).toHaveValue(
			"second-path",
		);
	},
};

export const DeleteException: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "例外の編集" }),
		);
		const deletion = await canvas.findByRole("button", {
			name: "例外 1を削除",
		});
		await userEvent.hover(deletion);
		const tooltip = await within(
			canvasElement.ownerDocument.body,
		).findByRole("tooltip");
		await waitFor(() => expect(tooltip).toBeVisible());
		await userEvent.click(deletion);
		await expect(
			canvas.getByRole("textbox", { name: "例外 1" }),
		).toHaveValue(".env.sample");
		await expect(
			canvas.queryByRole("button", { name: "例外 2を削除" }),
		).not.toBeInTheDocument();
	},
};

export const EditSelectedRuleExceptions: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: /ルールを追加/ }),
		);
		const id = canvas.getByRole("textbox", { name: "ID" });
		await userEvent.clear(id);
		await userEvent.type(id, "exception-target");
		await userEvent.click(
			canvas.getByRole("button", { name: "例外の編集" }),
		);
		await expect(
			canvas.getByRole("heading", { name: "exception-target" }),
		).toBeVisible();
		await expect(
			canvas.queryByRole("button", { name: /ルールを追加/ }),
		).not.toBeInTheDocument();
		await expect(
			canvas.queryByRole("button", { name: /パスルール .*を削除/ }),
		).not.toBeInTheDocument();
		await userEvent.click(
			canvas.getByRole("button", { name: "例外の追加" }),
		);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "例外 2" }),
			"safe.txt",
		);
		await userEvent.click(
			within(
				canvas.getByRole("navigation", { name: "ルールのカテゴリ" }),
			).getByRole("button", { name: /^パスルール/ }),
		);
		const list = within(canvas.getByRole("region", { name: "例外一覧" }));
		await expect(list.getByText("safe.txt")).toBeVisible();
		await expect(list.queryByRole("textbox")).not.toBeInTheDocument();
		await expect(canvas.getByRole("textbox", { name: "ID" })).toHaveValue(
			"exception-target",
		);
	},
};

export const HoldCommandDeletion: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await within(
				canvas.getByRole("navigation", { name: "ルールのカテゴリ" }),
			).findByRole("button", { name: /コマンドルール/ }),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: /ルールを追加/ }),
		);
		const deletion = canvas.getByRole("button", {
			name: "コマンドルール 1を削除",
		});
		await userEvent.click(deletion);
		await expect(canvas.getByRole("textbox", { name: "ID" })).toBeVisible();
		deletion.focus();
		await userEvent.keyboard("{Enter>}");
		await waitFor(
			() =>
				expect(
					canvas.queryByRole("textbox", { name: "ID" }),
				).not.toBeInTheDocument(),
			{ timeout: 4000 },
		);
		await userEvent.keyboard("{/Enter}");
	},
};

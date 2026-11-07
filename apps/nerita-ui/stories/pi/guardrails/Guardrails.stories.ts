// 既存の画面状態を Svelte コンポーネントで検証する。
import type { Meta, StoryObj } from "@storybook/svelte-vite";
import GuardrailsPreview from "./GuardrailsPreview.svelte";
import { storyHostPresentation } from "../../hostPresentation";
import {
	expect,
	fn,
	isMockFunction,
	userEvent,
	waitFor,
	within,
} from "storybook/test";
import { guardrailsConfigSchema } from "@nerita/shared/guardrails/config";
import {
	guardRequestSchema,
	type GuardRequest,
} from "@nerita/shared/guardrails/messages";

const meta = {
	title: "Pi/Guardrails",
	component: GuardrailsPreview,
	parameters: { layout: "fullscreen" },
	args: { onRequest: fn<(message: GuardRequest) => void>() },
} satisfies Meta<typeof GuardrailsPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
/** JSON の直接編集欄を使わず、Host へ送信した最新の編集内容を検証する。 */
function editedConfig(onRequest: unknown) {
	if (!isMockFunction(onRequest)) {
		throw new Error("送信内容を検証するモックがありません。");
	}
	const message = onRequest.mock.calls
		.map(([request]: unknown[]) => guardRequestSchema.parse(request))
		.reverse()
		.find((request) => request.type === "edit");
	if (message?.type !== "edit") {
		throw new Error("編集要求がまだ送信されていません。");
	}
	return guardrailsConfigSchema.parse(JSON.parse(message.text));
}
export const Editor: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.queryByRole("button", { name: "JSON" }),
		).not.toBeInTheDocument();
		await expect(
			canvas.queryByRole("textbox", { name: "設定JSON" }),
		).not.toBeInTheDocument();
	},
};

export const PrivacySettings: Story = {
	play: async ({ canvas, args, canvasElement }) => {
		await userEvent.click(
			canvas.getByRole("button", { name: "個人情報の送信" }),
		);
		const enabled = canvas.getByRole("checkbox", {
			name: "送信前の個人情報検査",
		});
		await expect(enabled).toBeChecked();
		const model = canvas.getByRole("checkbox", {
			name: "PII 検出モデルの利用",
		});
		await expect(model).toBeDisabled();
		await expect(model).not.toBeChecked();
		await expect(
			canvas.queryByRole("button", { name: "保護対象を登録" }),
		).not.toBeInTheDocument();

		await userEvent.click(enabled);
		await waitFor(() =>
			expect(editedConfig(args.onRequest).privacy.enabled).toBe(false),
		);
		await expect(editedConfig(args.onRequest).privacy.usePiiModel).toBe(
			false,
		);
		await expect(canvasElement.querySelector("main")).toHaveAttribute(
			"data-document-status",
			"未保存",
		);
		const save = canvas.getByRole("button", { name: "保存して適用" });
		await waitFor(() => expect(save).toBeEnabled());
		await userEvent.click(save);
		await expect(canvasElement.querySelector("main")).toHaveAttribute(
			"data-document-status",
			"適用済み",
		);
		await userEvent.click(enabled);
		await waitFor(() =>
			expect(editedConfig(args.onRequest).privacy.enabled).toBe(true),
		);
		const enableSave = await canvas.findByRole("button", {
			name: "保存して適用",
		});
		await waitFor(() => expect(enableSave).toBeEnabled());
		await userEvent.click(enableSave);
		await expect(enabled).toBeChecked();
		await expect(canvasElement.querySelector("main")).toHaveAttribute(
			"data-document-status",
			"適用済み",
		);
	},
};

export const PrivacyDisabled: Story = {
	args: { privacyEnabled: false },
	play: async ({ canvas }) => {
		await userEvent.click(
			canvas.getByRole("button", { name: "個人情報の送信" }),
		);
		await expect(
			canvas.getByRole("checkbox", { name: "送信前の個人情報検査" }),
		).not.toBeChecked();
		await expect(
			canvas.getByRole("checkbox", { name: "PII 検出モデルの利用" }),
		).toBeDisabled();
	},
};

export const PrivacySavePending: Story = {
	args: { pendingType: "save" },
	play: async ({ canvas }) => {
		await userEvent.click(
			canvas.getByRole("button", { name: "個人情報の送信" }),
		);
		const enabled = canvas.getByRole("checkbox", {
			name: "送信前の個人情報検査",
		});
		await userEvent.click(enabled);
		const save = canvas.getByRole("button", { name: "保存して適用" });
		await waitFor(() => expect(save).toBeEnabled());
		await userEvent.click(save);
		await expect(enabled).toBeDisabled();
		await expect(save).toBeDisabled();
	},
};

export const PrivacySaveFailure: Story = {
	args: { failure: "save" },
	play: async ({ canvas, canvasElement }) => {
		await userEvent.click(
			canvas.getByRole("button", { name: "個人情報の送信" }),
		);
		const enabled = canvas.getByRole("checkbox", {
			name: "送信前の個人情報検査",
		});
		await userEvent.click(enabled);
		const save = canvas.getByRole("button", { name: "保存して適用" });
		await waitFor(() => expect(save).toBeEnabled());
		await userEvent.click(save);
		await expect(await canvas.findByRole("alert")).toBeVisible();
		await expect(enabled).not.toBeChecked();
		await expect(enabled).toBeEnabled();
		await expect(canvasElement.querySelector("main")).toHaveAttribute(
			"data-document-status",
			"未保存",
		);
	},
};

export const PrivacyInvalidJson: Story = {
	args: { invalid: true },
	play: async ({ canvas }) => {
		await userEvent.click(
			canvas.getByRole("button", { name: "個人情報の送信" }),
		);
		await expect(
			canvas.queryByRole("checkbox", { name: "送信前の個人情報検査" }),
		).not.toBeInTheDocument();
		await expect(
			canvas.getByRole("button", { name: "保存して適用" }),
		).toBeDisabled();
	},
};
export const UnsavedChanges: Story = { args: { initialStatus: "dirty" } };
export const DiscardUnsavedChanges: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const id = canvas.getByRole("textbox", { name: "ID" });
		await userEvent.clear(id);
		await userEvent.type(id, "unsaved-local-rule");
		const restore = canvas.getByRole("button", {
			name: "適用中の設定に戻す",
		});
		await waitFor(() => expect(restore).toBeEnabled());
		await userEvent.click(restore);
		await expect(id).toHaveValue("env-files");
		await expect(restore).not.toBeInTheDocument();
	},
};
export const UnappliedChanges: Story = { args: { initialStatus: "unapplied" } };
export const SavePending: Story = {
	args: { initialStatus: "dirty", pendingType: "save" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "保存して適用" }),
		);
		await expect(
			canvas.getByRole("button", { name: "保存して適用" }),
		).toBeDisabled();
		await expect(
			canvas.getByRole("textbox", { name: "ID" }),
		).toBeDisabled();
	},
};
export const ApplySavedChanges: Story = {
	args: { initialStatus: "unapplied" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const footer = within(
			canvas.getByRole("region", { name: "ガードレールの状態と操作" }),
		);
		await userEvent.click(
			footer.getByRole("button", { name: "保存して適用" }),
		);
		await expect(canvasElement.querySelector("main")).toHaveAttribute(
			"data-document-status",
			"適用済み",
		);
		await expect(
			footer.queryByRole("button", { name: "適用中の設定に戻す" }),
		).not.toBeInTheDocument();
	},
};
export const DiscardSavedChanges: Story = {
	args: { initialStatus: "unapplied" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "適用中の設定に戻す" }),
		);
		await expect(canvasElement.querySelector("main")).toHaveAttribute(
			"data-document-status",
			"適用済み",
		);
		await userEvent.click(canvas.getByRole("button", { name: "概要" }));
		await userEvent.click(
			canvas.getByRole("combobox", {
				name: "ワークスペース外の読み取り",
			}),
		);
		const menu = within(canvasElement.ownerDocument.body);
		await expect(
			menu.getByRole("option", { name: "Deny · 拒否" }),
		).toHaveAttribute("aria-selected", "true");
		await userEvent.keyboard("{Escape}");
	},
};
export const DiscardError: Story = {
	args: { initialStatus: "unapplied", failure: "discard" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "適用中の設定に戻す" }),
		);
		await waitFor(() => expect(canvas.getByRole("alert")).toBeVisible());
		await expect(canvasElement.querySelector("main")).toHaveAttribute(
			"data-document-status",
			"保存済み・未適用",
		);
	},
};
export const AppliedSettingsUnavailable: Story = {
	args: { initialStatus: "unavailable" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByRole("button", { name: "適用中の設定に戻す" }),
		).toBeDisabled();
		await expect(
			canvas.getByRole("button", { name: "保存して適用" }),
		).toBeEnabled();
	},
};
export const InspectionWarnings: Story = {
	args: { warnings: ["外部応答の警告サンプル"] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const simulation = canvas.queryByRole("button", {
			name: "シミュレーション",
		});
		if (simulation !== null && simulation.getClientRects().length > 0) {
			await userEvent.click(simulation);
		}
		await userEvent.click(canvas.getByRole("button", { name: "検査" }));
		const result = within(canvas.getByRole("region", { name: "判定結果" }));
		await expect(result.getByText("外部応答の警告サンプル")).toBeVisible();
		const footer = within(canvasElement.querySelector("footer")!);
		await expect(
			footer.queryByText("外部応答の警告サンプル"),
		).not.toBeInTheDocument();
		await waitFor(() =>
			expect(canvasElement.querySelector("footer")).toHaveAttribute(
				"inert",
			),
		);
	},
};
export const LongInspectionWarnings: Story = {
	...InspectionWarnings,
	args: {
		warnings: [
			"外部応答の警告サンプル",
			...Array.from(
				{ length: 8 },
				(_, index) =>
					`警告 ${index + 1}: 共有ルールを確認してください。${"長いパスの表示確認/".repeat(8)}`,
			),
		],
	},
};
export const ManyPathRules: Story = {
	args: { pathRuleCount: 40 },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const list = await canvas.findByRole("region", {
			name: "パスルール一覧",
		});
		await waitFor(() =>
			expect(list.scrollHeight).toBeGreaterThan(list.clientHeight),
		);
		list.scrollTop = list.scrollHeight;
		await waitFor(() => expect(list.scrollTop).toBeGreaterThan(0));
		const last = within(list).getByRole("button", { name: "path-39" });
		await userEvent.click(last);
		await expect(canvas.getByRole("textbox", { name: "ID" })).toHaveValue(
			"path-39",
		);
		list.scrollTop = 0;
		await userEvent.click(
			within(list).getByRole("button", { name: "env-files" }),
		);
		await expect(canvas.getByRole("textbox", { name: "ID" })).toHaveValue(
			"env-files",
		);
	},
};
export const BuiltinSwitches: Story = {
	play: async ({ canvasElement, args }) => {
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
		await waitFor(async () => {
			const config = editedConfig(args.onRequest);
			await expect(config.builtins.paths.ssh).toBe("ask");
			await expect(config.builtins.commands.git).toBe("deny");
		});
		await userEvent.click(
			canvas.getByRole("button", { name: "保存して適用" }),
		);
	},
};
export const SwitchPathMatch: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const menu = within(canvasElement.ownerDocument.body);
		const input = canvas.getByRole("textbox", {
			name: "相対パス / パターン",
		});
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
			if (name === "ディレクトリ配下") {
				await expect(input).toHaveValue(".");
			} else {
				await expect(input).toHaveValue(".env*");
			}
		}
	},
};

export const SelectDirectory: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		await expect(
			canvas.queryByRole("button", { name: "ディレクトリの選択" }),
		).not.toBeInTheDocument();
		await userEvent.click(canvas.getByRole("combobox", { name: "照合" }));
		await userEvent.click(
			await page.findByRole("option", { name: "ディレクトリ配下" }),
		);
		const button = canvas.getByRole("button", {
			name: "ディレクトリの選択",
		});
		await waitFor(() => expect(button).toBeEnabled());
		await userEvent.hover(button);
		await waitFor(() => expect(page.getByRole("tooltip")).toBeVisible());
		await userEvent.click(button);
		await waitFor(() =>
			expect(
				canvas.getByRole("textbox", { name: "相対パス / パターン" }),
			).toHaveValue("src/private"),
		);
		await waitFor(async () => {
			const config = editedConfig(args.onRequest);
			await expect(config.pathRules[0]?.directory).toBe("src/private");
			await expect(config.pathRules[0]?.pattern).toBe(".env*");
		});
	},
};
export const CancelDirectorySelection: Story = {
	args: { selectedDirectory: null },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("combobox", { name: "照合" }));
		await userEvent.click(
			await within(canvasElement.ownerDocument.body).findByRole(
				"option",
				{ name: "ディレクトリ配下" },
			),
		);
		const button = canvas.getByRole("button", {
			name: "ディレクトリの選択",
		});
		await waitFor(() => expect(button).toBeEnabled());
		await userEvent.click(button);
		await expect(
			canvas.getByRole("textbox", { name: "相対パス / パターン" }),
		).toHaveValue(".");
		await expect(button).toBeEnabled();
	},
};

export const GlobPatternHelp: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		const pattern = canvas.getByRole("textbox", {
			name: "相対パス / パターン",
		});
		await expect(canvas.queryByRole("tooltip")).not.toBeInTheDocument();
		await userEvent.click(pattern);
		const help = canvas.getByRole("tooltip");
		await expect(help).toBeVisible();
		await expect(pattern).toHaveAttribute("aria-describedby", help.id);
		await userEvent.keyboard("{Escape}");
		await expect(canvas.queryByRole("tooltip")).not.toBeInTheDocument();
		for (const name of ["ディレクトリ配下", "Glob"]) {
			await userEvent.click(
				canvas.getByRole("combobox", { name: "照合" }),
			);
			await userEvent.click(await page.findByRole("option", { name }));
			await userEvent.click(pattern);
			if (name === "Glob") {
				await expect(canvas.getByRole("tooltip")).toBeVisible();
			} else {
				await expect(
					canvas.queryByRole("tooltip"),
				).not.toBeInTheDocument();
			}
		}
		await userEvent.tab();
		await expect(canvas.queryByRole("tooltip")).not.toBeInTheDocument();
		await userEvent.click(pattern);
		await expect(canvas.getByRole("tooltip")).toBeVisible();
	},
};
export const Loading: Story = { args: { loading: true } };
export const InvalidJson: Story = {
	args: { invalid: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const alert = await canvas.findByRole("alert");
		await expect(alert).toHaveTextContent(
			storyHostPresentation.guardrailsRepairDescription,
		);
		await waitFor(() => expect(alert).toBeVisible());
		alert.scrollIntoView({ block: "nearest" });
		await expect(
			canvas.queryByRole("textbox", { name: "設定JSON" }),
		).not.toBeInTheDocument();
		await expect(
			canvas.getByRole("button", { name: "保存して適用" }),
		).toBeDisabled();
	},
};
export const SaveError: Story = {
	args: { failure: "save", initialStatus: "dirty" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "保存して適用" }),
		);
		await waitFor(() => expect(canvas.getByRole("alert")).toBeVisible());
		const footer = within(
			canvas.getByRole("region", { name: "ガードレールの状態と操作" }),
		);
		await expect(footer.queryByRole("status")).not.toBeInTheDocument();
		await expect(
			footer.getByRole("button", { name: "保存して適用" }),
		).toBeEnabled();
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
		const target = "private/settings.json";
		const input = canvas.getByRole("textbox", {
			name: "対象パス / コマンド",
		});
		await userEvent.clear(input);
		await userEvent.type(input, target);
		await userEvent.click(
			await canvas.findByRole("button", { name: "検査" }),
		);
		await waitFor(() => expect(canvas.getByRole("alert")).toBeVisible());
		await expect(canvas.getByRole("alert")).toHaveTextContent(target);
		canvas.getByRole("alert").scrollIntoView({ block: "nearest" });
	},
};
export const EditConflict: Story = {
	args: { failure: "edit" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			canvas.getByRole("textbox", { name: "ID" }),
			"-local",
		);
		await waitFor(() => expect(canvas.getByRole("alert")).toBeVisible());
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

export const ChangedInspectionInput: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const simulation = canvas.queryByRole("button", {
			name: "シミュレーション",
		});
		if (simulation !== null && simulation.getClientRects().length > 0) {
			await userEvent.click(simulation);
		}
		for (const [label, value] of [
			["対象パス / コマンド", "src/public.ts"],
			["cwd（ワークスペース基準）", "src"],
		] as const) {
			await userEvent.click(canvas.getByRole("button", { name: "検査" }));
			await expect(
				canvas.getByRole("region", { name: "判定結果" }),
			).toBeVisible();
			const input = canvas.getByRole("textbox", { name: label });
			await userEvent.clear(input);
			await userEvent.type(input, value);
			await expect(
				canvas.queryByRole("region", { name: "判定結果" }),
			).not.toBeInTheDocument();
		}
		await userEvent.click(canvas.getByRole("button", { name: "検査" }));
		await expect(
			canvas.getByRole("region", { name: "判定結果" }),
		).toBeVisible();
		await userEvent.click(canvas.getByRole("combobox", { name: "Tool" }));
		await userEvent.click(
			await within(canvasElement.ownerDocument.body).findByRole(
				"option",
				{ name: "write" },
			),
		);
		await expect(
			canvas.queryByRole("region", { name: "判定結果" }),
		).not.toBeInTheDocument();
	},
};

export const LateInspectionResult: Story = {
	args: { pendingType: "check" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const simulation = canvas.queryByRole("button", {
			name: "シミュレーション",
		});
		if (simulation !== null && simulation.getClientRects().length > 0) {
			await userEvent.click(simulation);
		}
		const check = canvas.getByRole("button", { name: "検査" });
		await userEvent.click(check);
		await expect(check).toBeDisabled();
		const input = canvas.getByRole("textbox", {
			name: "対象パス / コマンド",
		});
		await userEvent.clear(input);
		await userEvent.type(input, "src/after-request.ts");
		const preview = canvasElement.querySelector<
			HTMLElement & { response: { release?: () => void } }
		>("[data-story-guardrails]");
		await expect(typeof preview?.response.release).toBe("function");
		preview?.response.release?.();
		await waitFor(() => expect(check).toBeEnabled());
		await expect(
			canvas.queryByRole("region", { name: "判定結果" }),
		).not.toBeInTheDocument();
		await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
	},
};
export const LateInspectionError: Story = {
	...LateInspectionResult,
	args: { pendingType: "check", failure: "check" },
};

export const SearchCommandRules: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			within(
				canvas.getByRole("navigation", { name: "ルールのカテゴリ" }),
			).getByRole("button", { name: /コマンドルール/ }),
		);
		const add = canvas.getByRole("button", { name: /ルールを追加/ });
		await userEvent.click(add);
		await userEvent.click(add);
		const id = canvas.getByRole("textbox", { name: "ID" });
		await expect(id).toHaveValue("command-2");
		await expect(
			canvas.queryByRole("combobox", { name: "コマンドルールを選択" }),
		).not.toBeInTheDocument();
		const search = canvas.getByRole("searchbox", {
			name: "コマンドルールを検索",
		});
		await userEvent.type(search, "command-1");
		const list = within(
			canvas.getByRole("region", { name: "コマンドルール一覧" }),
		);
		await expect(
			list.queryByRole("button", { name: "command-2" }),
		).not.toBeInTheDocument();
		await userEvent.click(list.getByRole("button", { name: "command-1" }));
		await expect(id).toHaveValue("command-1");
	},
};

export const RuleSelection: Story = {
	play: async ({ canvasElement, args }) => {
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
		await waitFor(() =>
			expect(
				editedConfig(args.onRequest).pathRules.map((rule) => rule.id),
			).toEqual(["env-files", "second-path"]),
		);
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
			within(
				canvas.getByRole("region", { name: "パスルール一覧" }),
			).getByRole("button", { name: "env-files" }),
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
		const list = canvas.getByRole("region", { name: "パスルール一覧" });
		for (let frame = 0; frame < 12; frame++) {
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
			await expect(list.scrollWidth).toBeLessThanOrEqual(
				list.clientWidth,
			);
		}
		await userEvent.keyboard("{/Enter}");
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

export const SearchPathRules: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: /ルールを追加/ }),
		);
		const id = canvas.getByRole("textbox", { name: "ID" });
		await userEvent.clear(id);
		await userEvent.type(id, "second-path");
		const search = canvas.getByRole("searchbox", {
			name: "パスルールを検索",
		});
		await userEvent.type(search, "ENV-FILES");
		const list = within(
			canvas.getByRole("region", { name: "パスルール一覧" }),
		);
		await expect(
			list.queryByRole("button", { name: "second-path" }),
		).not.toBeInTheDocument();
		await expect(id).toHaveValue("second-path");
		await userEvent.click(list.getByRole("button", { name: "env-files" }));
		await expect(id).toHaveValue("env-files");
		await userEvent.clear(search);
		await userEvent.type(search, "second-path");
		const deletion = list.getByRole("button", {
			name: "パスルール 2を削除",
		});
		deletion.focus();
		await userEvent.keyboard("{Enter>}");
		await waitFor(
			() =>
				expect(
					list.queryByRole("button", { name: "second-path" }),
				).not.toBeInTheDocument(),
			{ timeout: 4000 },
		);
		await userEvent.keyboard("{/Enter}");
		await expect(id).toHaveValue("env-files");
		await userEvent.clear(search);
		await expect(
			list.getByRole("button", { name: "env-files" }),
		).toBeVisible();
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

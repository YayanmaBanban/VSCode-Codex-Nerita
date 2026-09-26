// 通信 DTO の受理・拒否と元データの保持を、独立した期待値で検証する。
import { describe, expect, it } from "vitest";
import { IdSchema } from "../../src/shared/composerSchemas";
import { validComposerField } from "../../src/shared/composerValidation";
import { isUiContributions } from "../../src/shared/uiContributionValidation";
import { isState } from "../../src/shared/stateValidation";
import { initialState } from "../../src/shared/chatState";

const choice = { value: "model", name: "Model", description: "choice" };
const option = {
	id: "model",
	name: "Model",
	currentValue: "hidden",
	currentLabel: "Hidden model",
	description: "option",
	options: [choice],
};
const window = { label: "Weekly", remaining: 50, detail: "Tomorrow" };
const toggle = {
	type: "toggle",
	configId: "fast",
	label: "Fast",
	checked: true,
	onValue: "on",
	offValue: "off",
};

/** 通信境界に渡す単一コントロールを組み立てる。 */
function contribution(control: unknown, change: Record<string, unknown> = {}) {
	return {
		surface: "pi",
		items: [{ id: "test", slot: "status", control, ...change }],
	};
}

describe("Composer / UI contribution contract", () => {
	it("通信用 ID は UTF-16 の 1〜256 単位だけを受理する", () => {
		for (const [value, accepted] of [
			["a", true],
			["a".repeat(256), true],
			["😀".repeat(128), true],
			["", false],
			["a".repeat(257), false],
			["😀".repeat(129), false],
			[null, false],
			[1, false],
		] as const) {
			expect(IdSchema.safeParse(value).success).toBe(accepted);
		}
	});

	it("Composer は隠れた現在値と重複候補を保持し、UI の選択肢は一意にする", () => {
		expect(validComposerField("configOptions", [option])).toBe(true);
		const permissive = {
			...option,
			id: "",
			description: 42,
			options: [choice, choice],
		};
		expect(validComposerField("configOptions", [permissive])).toBe(true);
		for (const change of [
			{ id: 1 },
			{ name: null },
			{ currentValue: false },
			{ currentLabel: 0 },
			{ options: null },
			{ options: [{ ...choice, name: 1 }] },
		]) {
			expect(
				validComposerField("configOptions", [{ ...option, ...change }]),
			).toBe(false);
		}
		expect(
			isUiContributions(contribution({ type: "select", option })),
		).toBe(true);
		for (const change of [
			{ id: "" },
			{ description: 42 },
			{ options: [choice, choice] },
			{ options: [{ ...choice, value: "" }] },
			{ options: [{ ...choice, description: 42 }] },
		]) {
			expect(
				isUiContributions(
					contribution({
						type: "select",
						option: { ...option, ...change },
					}),
				),
			).toBe(false);
		}
	});

	it("利用枠と進捗は有限の 0〜100 を受理し、未取得と空配列を区別する", () => {
		expect(validComposerField("quota", null)).toBe(true);
		expect(validComposerField("quota", [])).toBe(false);
		for (const [value, accepted] of [
			[0, true],
			[0.5, true],
			[100, true],
			[-1, false],
			[101, false],
			[NaN, false],
			[Infinity, false],
			["50", false],
			[null, false],
		] as const) {
			const windows = [{ ...window, remaining: value }];
			expect(validComposerField("quota", windows)).toBe(accepted);
			expect(
				isUiContributions(contribution({ type: "quota", windows })),
			).toBe(accepted);
			expect(
				isUiContributions(
					contribution({ type: "progress", label: "p", value }),
				),
			).toBe(accepted);
		}
		for (const windows of [null, [], [{ remaining: 50 }]]) {
			expect(
				isUiContributions(contribution({ type: "quota", windows })),
			).toBe(false);
		}
	});

	it("全 control の必須項目と任意表示情報を検証し、切替の同一送信値を拒否する", () => {
		const controls = [
			{ type: "select", option },
			{ type: "quota", windows: [window] },
			toggle,
			{ type: "progress", label: "Progress", value: 50 },
		];
		for (const control of controls) {
			expect(
				isUiContributions(
					contribution({
						...control,
						disabled: false,
						description: "details",
					}),
				),
			).toBe(true);
			for (const field of Object.keys(control)) {
				expect(
					isUiContributions(
						contribution({ ...control, [field]: undefined }),
					),
					field,
				).toBe(false);
			}
			for (const change of [{ disabled: "false" }, { description: 1 }]) {
				expect(
					isUiContributions(contribution({ ...control, ...change })),
				).toBe(false);
			}
		}
		for (const change of [
			{ checked: "true" },
			{ configId: "" },
			{ onValue: "" },
			{ offValue: "on" },
		]) {
			expect(
				isUiContributions(contribution({ ...toggle, ...change })),
			).toBe(false);
		}
		expect(isUiContributions(contribution({ type: "unknown" }))).toBe(
			false,
		);
	});

	it("surface・slot・有限 order を検証し、重複 ID と未解決条件を拒否する", () => {
		for (const surface of ["pi", "codex"]) {
			for (const slot of [
				"settings.main",
				"settings.advanced",
				"model.header",
				"composer.toolbar",
				"status",
			]) {
				expect(
					isUiContributions({
						...contribution(toggle, { slot, order: -1.5 }),
						surface,
					}),
				).toBe(true);
			}
		}
		for (const change of [
			{ id: "" },
			{ slot: "unknown" },
			{ order: Infinity },
			{ order: "1" },
			{ when: {} },
			{ when: null },
		]) {
			expect(isUiContributions(contribution(toggle, change))).toBe(false);
		}
		const value = contribution(toggle);
		for (const invalid of [
			null,
			[],
			{ ...value, surface: "unknown" },
			{ ...value, items: null },
			{ ...value, items: [...value.items, ...value.items] },
		]) {
			expect(isUiContributions(invalid)).toBe(false);
		}
		expect(isState({ ...initialState(), uiContributions: value })).toBe(
			true,
		);
		expect(
			isState({
				...initialState(),
				uiContributions: { ...value, surface: "unknown" },
			}),
		).toBe(false);
	});

	it("検証は未知キーと元のオブジェクトを変更しない", () => {
		const extra = { future: true };
		const nestedOption = {
			...option,
			extra,
			options: [{ ...choice, extra }],
		};
		const control = { type: "select", option: nestedOption, extra };
		const value = { ...contribution(control, { extra }), extra };
		const before = structuredClone(value);
		expect(isUiContributions(value)).toBe(true);
		expect(validComposerField("configOptions", [nestedOption])).toBe(true);
		expect(value).toEqual(before);
	});
});

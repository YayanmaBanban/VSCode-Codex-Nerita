// 移行前guardと同じ入力を比較し、境界差・未知キー・元データ保持を固定する。
import { describe, expect, it } from "vitest";
import {
	ConfigChoiceSchema,
	ConfigOptionSchema,
	IdSchema,
	QuotaWindowSchema,
} from "../../src/shared/composerSchemas";
import { validComposerField } from "../../src/shared/composerValidation";
import { isUiContributions } from "../../src/shared/uiContributionValidation";
import { validComposerField as legacyComposer } from "../fixtures/phase9/legacyComposerValidation";
import { isUiContributions as legacyUi } from "../fixtures/phase9/legacyUiContributionValidation";

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
const controls = [
	{ type: "select", option },
	{ type: "quota", windows: [window] },
	{
		type: "toggle",
		configId: "fast",
		label: "Fast",
		checked: true,
		onValue: "on",
		offValue: "off",
	},
	{ type: "progress", label: "Progress", value: 50 },
];
const invalid = [undefined, null, false, 0, "", [], {}];
const ids = [
	"",
	"a",
	"a".repeat(256),
	"a".repeat(257),
	"😀".repeat(128),
	"😀".repeat(129),
	null,
	1,
];
const percentages = [
	-1,
	0,
	0.5,
	100,
	101,
	NaN,
	Infinity,
	-Infinity,
	"50",
	null,
	undefined,
];

/** 単一controlを解決済み通信形式へ包む。 */
function contribution(control: unknown, change: Record<string, unknown> = {}) {
	return {
		surface: "pi",
		items: [{ id: "test", slot: "status", control, ...change }],
	};
}

/** 同じ入力集合について旧guardとの受理・拒否の一致を確認する。 */
function compareUi(value: unknown) {
	expect(isUiContributions(value), JSON.stringify(value)).toBe(
		legacyUi(value),
	);
}

describe("Phase 9 通信Schema", () => {
	it("共通DTOとoptional表示情報を受理する", () => {
		expect(ConfigChoiceSchema.safeParse(choice).success).toBe(true);
		expect(ConfigOptionSchema.safeParse(option).success).toBe(true);
		expect(QuotaWindowSchema.safeParse(window).success).toBe(true);
		expect(
			ConfigOptionSchema.safeParse({ ...option, description: 1 }).success,
		).toBe(false);
		for (const value of ids) {
			expect(IdSchema.safeParse(value).success).toBe(
				typeof value === "string" &&
					value.length > 0 &&
					value.length <= 256,
			);
		}
	});

	it("Composerの緩いID・description・重複候補とQuotaの制約を維持する", () => {
		const options: unknown[] = [...invalid, [], [option]];
		for (const id of ids) {
			options.push([{ ...option, id }]);
		}
		for (const value of ids) {
			options.push([{ ...option, options: [{ ...choice, value }] }]);
		}
		for (const field of [
			"name",
			"currentValue",
			"currentLabel",
			"description",
			"options",
		]) {
			for (const value of [...invalid, "text"]) {
				options.push([{ ...option, [field]: value }]);
			}
		}
		for (const field of ["name", "description"]) {
			for (const value of [...invalid, "text"]) {
				options.push([
					{ ...option, options: [{ ...choice, [field]: value }] },
				]);
			}
		}
		options.push([{ ...option, options: [choice, choice] }]);
		for (const value of options) {
			expect(validComposerField("configOptions", value)).toBe(
				legacyComposer("configOptions", value),
			);
		}
		for (const value of [
			...invalid,
			[window],
			...percentages.map((remaining) => [{ ...window, remaining }]),
		]) {
			expect(validComposerField("quota", value)).toBe(
				legacyComposer("quota", value),
			);
		}
		expect(
			validComposerField("configOptions", [
				{ ...option, description: 42, options: [choice, choice] },
			]),
		).toBe(true);
		expect(
			isUiContributions(
				contribution({
					type: "select",
					option: { ...option, description: 42 },
				}),
			),
		).toBe(false);
	});

	it("全controlのフィールド変異で旧guardとの一致を確認する", () => {
		for (const value of invalid) {
			compareUi(value);
		}
		for (const control of controls) {
			expect(isUiContributions(contribution(control))).toBe(true);
			for (const field of [
				...Object.keys(control),
				"disabled",
				"description",
			]) {
				for (const value of [...invalid, "text", true, 50]) {
					compareUi(contribution({ ...control, [field]: value }));
				}
			}
		}
		for (const value of percentages) {
			compareUi(contribution({ type: "progress", label: "p", value }));
			compareUi(
				contribution({
					type: "quota",
					windows: [{ ...window, remaining: value }],
				}),
			);
		}
		for (const field of [
			"id",
			"name",
			"description",
			"currentValue",
			"currentLabel",
			"options",
		]) {
			for (const value of [...invalid, ...ids, "text"]) {
				compareUi(
					contribution({
						type: "select",
						option: { ...option, [field]: value },
					}),
				);
			}
		}
		for (const field of ["value", "name", "description"]) {
			for (const value of [...invalid, ...ids, "text"]) {
				compareUi(
					contribution({
						type: "select",
						option: {
							...option,
							options: [{ ...choice, [field]: value }],
						},
					}),
				);
			}
		}
		for (const field of ["configId", "onValue", "offValue"]) {
			for (const value of ids) {
				compareUi(contribution({ ...controls[2], [field]: value }));
			}
		}
		expect(
			isUiContributions(contribution({ ...controls[2], onValue: "off" })),
		).toBe(false);
		expect(
			isUiContributions(
				contribution({
					type: "select",
					option: { ...option, options: [choice, choice] },
				}),
			),
		).toBe(false);
		expect(isUiContributions(contribution({ type: "unknown" }))).toBe(
			false,
		);
	});

	it("surface・slot・order・重複ID・未解決条件の既存判定を維持する", () => {
		for (const surface of [...invalid, "codex", "pi", "other"]) {
			compareUi({ ...contribution(controls[0]), surface });
		}
		for (const id of ids) {
			compareUi(contribution(controls[0], { id }));
		}
		for (const order of [...percentages, -100, 1.5]) {
			compareUi(contribution(controls[0], { order }));
		}
		for (const slot of [
			...invalid,
			"settings.main",
			"settings.advanced",
			"model.header",
			"composer.toolbar",
			"status",
			["status"],
		]) {
			compareUi(contribution(controls[0], { slot }));
		}
		for (const when of [...invalid, { backend: "pi" }]) {
			const value = contribution(controls[0], { when });
			compareUi(value);
			expect(isUiContributions(value)).toBe(when === undefined);
		}
		const value = contribution(controls[0]);
		value.items.push(value.items[0]!);
		expect(isUiContributions(value)).toBe(false);
		compareUi(value);
	});

	it("検証で未知キーを除去せず、ネストした参照と値を保持する", () => {
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
		expect(value.items[0]!.control).toBe(control);
		expect(control.option).toBe(nestedOption);
		expect(control.option.options[0]!.extra).toBe(extra);
	});
});

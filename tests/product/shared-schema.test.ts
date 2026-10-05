// 通信ガードの拒否境界と、未知キー・元オブジェクトの参照保持を継続して検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { isUiContributions } from "@nerita/shared/uiContributionValidation";
import { validComposerField } from "@nerita/shared/composerValidation";
import { isHostMessage } from "@nerita/shared/hostMessageValidation";

void test("宣言型 UI は ID・重複・未解決条件・同値切替・非有限進捗を拒否し、未知キーと参照を保持する", () => {
	const option = {
		id: "model",
		name: "モデル",
		currentValue: "first",
		options: [{ value: "first", name: "最初" }],
		extra: { keep: true },
	};
	const item = {
		id: "selection",
		slot: "model.header",
		control: { type: "select", option },
		extra: "keep",
	};
	const value = { surface: "pi", items: [item], extra: { keep: true } };
	const message = {
		type: "state/patch",
		revision: 1,
		patch: { uiContributions: value },
	};
	assert.ok(isHostMessage(message));
	assert.equal(message.patch.uiContributions, value);
	assert.equal(value.items[0], item);
	assert.equal(item.control.option, option);
	assert.equal(option.extra.keep, true);
	for (const id of ["a".repeat(256), "🐈".repeat(128)]) {
		assert.equal(
			isUiContributions({ ...value, items: [{ ...item, id }] }),
			true,
		);
	}
	for (const invalid of [
		{ ...item, id: "" },
		{ ...item, id: "🐈".repeat(129) },
		{ ...item, when: { backend: "pi" } },
		{ ...item, control: { type: "unknown" } },
		{
			...item,
			control: {
				type: "select",
				option: {
					...option,
					options: [option.options[0], option.options[0]],
				},
			},
		},
		{
			...item,
			control: {
				type: "toggle",
				configId: "flag",
				label: "切替",
				checked: false,
				onValue: "same",
				offValue: "same",
			},
		},
		...[NaN, Infinity, -1, 101].map((progress) => ({
			...item,
			control: { type: "progress", label: "進捗", value: progress },
		})),
	]) {
		assert.equal(
			isUiContributions({ ...value, items: [invalid] }),
			false,
			JSON.stringify(invalid),
		);
	}
	assert.equal(isUiContributions({ ...value, items: [item, item] }), false);
});

void test("Composer の既存の緩い条件を維持する", () => {
	assert.equal(
		validComposerField("configOptions", [
			{
				id: "",
				name: "モデル",
				currentValue: "",
				description: 1,
				options: [{ value: "", name: "候補", description: false }],
			},
		]),
		true,
	);
});

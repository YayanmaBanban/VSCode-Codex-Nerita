// 通信ガードの拒否境界と、未知キー・元オブジェクトの参照保持を継続して検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { isUiContributions } from "@nerita/shared/uiContributionValidation";
import { validComposerField } from "@nerita/shared/composerValidation";
import { isHostMessage } from "@nerita/shared/hostMessageValidation";
import { isPiAuthState } from "@nerita/shared/piAuth";
import { errorText } from "@nerita/shared/errorText";
import { validStateField } from "@nerita/shared/stateFieldValidation";
import { isUiMessage } from "@nerita/shared/uiMessageValidation";
import { isAsyncTask } from "@nerita/shared/asyncTask";
import { initialState } from "@nerita/shared/chatState";
import {
	isNonEmptyString,
	isNonZeroNumber,
	nonEmptyString,
	nonZeroNumber,
} from "@nerita/shared/valuePredicates";

void test("条件式と代替値の選択は空文字・未設定・ゼロ・NaN を除外し、空白・負数・無限大を保持する", () => {
	for (const value of [undefined, null, ""]) {
		assert.equal(isNonEmptyString(value), false);
		assert.equal(nonEmptyString(value) ?? "fallback", "fallback");
	}

	for (const value of [" ", "0", "false", "名前"]) {
		assert.equal(isNonEmptyString(value), true);
		assert.equal(nonEmptyString(value) ?? "fallback", value);
	}
	for (const value of [undefined, null, 0, -0, NaN]) {
		assert.equal(isNonZeroNumber(value), false);
		assert.equal(nonZeroNumber(value) ?? 100, 100);
	}
	for (const value of [-1, 1, Infinity, -Infinity]) {
		assert.equal(isNonZeroNumber(value), true);
		assert.equal(nonZeroNumber(value) ?? 100, value);
	}
});

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
		{ ...item, slot: ["model.header"] },
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

void test("通信の状態と操作種別は文字列だけを受理し、同じ文字列に変換できる配列を拒否する", () => {
	assert.equal(validStateField("connection", "ready"), true);
	assert.equal(validStateField("run", "running"), true);
	assert.equal(validStateField("connection", ["ready"]), false);
	assert.equal(validStateField("run", ["running"]), false);
	const decision = {
		type: "plan/decide",
		requestId: "decision",
		sessionId: "session",
		runId: "run",
		action: "continue",
	};
	assert.equal(isUiMessage(decision), true);
	assert.equal(isUiMessage({ ...decision, action: ["continue"] }), false);
	const task = { asyncTaskId: "task", state: "running", canStop: true };
	assert.equal(isAsyncTask(task), true);
	assert.equal(isAsyncTask({ ...task, state: ["running"] }), false);
});

void test("エラー表示は名前と本文を保持し、未知のオブジェクト全体や任意の文字列化処理を使わない", () => {
	assert.equal(
		errorText(new TypeError("invalid input")),
		"TypeError: invalid input",
	);
	assert.equal(errorText("cancelled"), "cancelled");
	assert.equal(
		errorText({ message: "remote error", privateValue: "secret" }),
		"remote error",
	);
	assert.equal(errorText(42), "42");
	assert.equal(errorText(null), "不明なエラー");
	assert.equal(errorText(undefined), "不明なエラー");
	const error = {
		privateValue: "secret",
		toString() {
			throw new Error("文字列化してはいけない");
		},
	};
	assert.equal(errorText(error), "不明なエラー");
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

void test("認証状態は両方の保存方式を受け入れ、壊れた入れ子を例外なく拒否する", () => {
	const item = {
		id: "provider",
		name: "Provider",
		configured: true,
		accounts: [
			{ id: "session", name: "Session", mode: "session", active: true },
			{
				id: "saved",
				name: "Saved",
				mode: "secret-storage",
				active: false,
			},
		],
		methods: [{ id: "key", name: "API key" }],
	};
	const value = {
		items: [item],
		active: null,
		notice: "",
		error: null,
		prompt: {
			id: "key",
			message: "入力",
			secret: true,
			options: [{ id: "first", label: "最初" }],
		},
		feedback: { provider: { notice: "", error: null } },
	};
	assert.equal(isPiAuthState(value), true);
	assert.equal(
		isPiAuthState({ ...value, prompt: null, feedback: undefined }),
		true,
	);
	for (const invalid of [
		{ ...value, items: [null] },
		{ ...value, items: [{ ...item, accounts: [null] }] },
		{
			...value,
			items: [
				{
					...item,
					accounts: [{ ...item.accounts[0], mode: "unknown" }],
				},
			],
		},
		{ ...value, items: [{ ...item, methods: [null] }] },
		{ ...value, prompt: undefined },
		{ ...value, prompt: { ...value.prompt, options: [null] } },
		{ ...value, feedback: null },
		{ ...value, feedback: { provider: null } },
	]) {
		assert.equal(isPiAuthState(invalid), false, JSON.stringify(invalid));
	}
});

void test("Host の任意フィールドはスナップショット・差分・ツール更新で検証し、元参照を維持する", () => {
	const message = {
		id: "message",
		role: "user",
		text: "hello",
		references: [],
		order: 1,
		extra: { keep: true },
	};
	const tool = {
		id: "tool",
		title: "tool",
		status: "completed",
		paths: [],
		cwd: "workspace",
		backgrounded: false,
		order: 2,
		runId: "run",
		content: [
			{ type: "content", content: { type: "text", text: "result" } },
		],
	};
	for (const patch of [{ messages: [message] }, { tools: [tool] }]) {
		const notification = { type: "state/patch", revision: 1, patch };
		assert.ok(isHostMessage(notification));
		assert.equal(notification.patch, patch);
	}
	assert.ok(
		isHostMessage({
			type: "state/snapshot",
			state: { ...initialState(), messages: [message], tools: [tool] },
		}),
	);
	for (const invalid of [
		{ references: null },
		{ references: [{}] },
		{ order: "wrong" },
		{ order: NaN },
	]) {
		const messages = [{ ...message, ...invalid }];
		assert.equal(
			isHostMessage({
				type: "state/patch",
				revision: 1,
				patch: { messages },
			}),
			false,
			JSON.stringify(invalid),
		);
		assert.equal(
			isHostMessage({
				type: "state/snapshot",
				state: { ...initialState(), messages },
			}),
			false,
			JSON.stringify(invalid),
		);
	}
});

void test("ツールの任意フィールドはスナップショット・差分・ツール更新で不正な値を拒否する", () => {
	const tool = {
		id: "tool",
		title: "tool",
		status: "completed",
		paths: [],
		cwd: "workspace",
		backgrounded: false,
		order: 2,
		runId: "run",
		content: [
			{ type: "content", content: { type: "text", text: "result" } },
		],
	};
	for (const invalid of [
		{ cwd: 42 },
		{ backgrounded: "wrong" },
		{ runId: {} },
		{ order: "wrong" },
		{ content: [{ type: "content", content: { type: "text", text: 42 } }] },
		{ searchLabel: null },
		{ commandOutput: [] },
	]) {
		const tools = [{ ...tool, ...invalid }];
		assert.equal(
			isHostMessage({
				type: "state/patch",
				revision: 1,
				patch: { tools },
			}),
			false,
			JSON.stringify(invalid),
		);
		assert.equal(
			isHostMessage({
				type: "state/patch",
				revision: 1,
				patch: {},
				toolUpdates: tools,
			}),
			false,
			JSON.stringify(invalid),
		);
		assert.equal(
			isHostMessage({
				type: "state/snapshot",
				state: { ...initialState(), tools },
			}),
			false,
			JSON.stringify(invalid),
		);
	}
});

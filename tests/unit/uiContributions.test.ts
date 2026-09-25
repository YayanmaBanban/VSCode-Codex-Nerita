// Host 条件解決・通信検証・状態更新での再生成を UI なしで検証する。
import { describe, expect, it } from "vitest";
import { initialState, type ChatState } from "../../src/shared/chatState";
import type { NeritaUiContribution } from "../../src/shared/uiContributions";
import { isUiContributions } from "../../src/shared/uiContributionValidation";
import { isState } from "../../src/shared/stateValidation";
import { UiContributionRegistry } from "../../src/extension/ui-contributions/UiContributionRegistry";
import { createBuiltinUiRegistry } from "../../src/extension/ui-contributions/builtinContributions";
import { SessionState } from "../../src/extension/session/sessionState";
import type { ContributionContext } from "../../src/extension/ui-contributions/contributionConditions";
import { PiSessionController } from "../../src/extension/backends/pi/PiSessionController";
import { piHarness } from "./piHarness";

const context: ContributionContext = {
	backend: "pi",
	provider: "openai-codex",
	capabilities: ["quota"],
};
const item: NeritaUiContribution = {
	id: "quota",
	slot: "status",
	control: { type: "progress", label: "Quota", value: 68 },
	when: { backend: "pi", provider: "openai-codex", capability: "quota" },
};

describe("UI Contribution Registry", () => {
	it("backend・provider・capabilityをANDで解決し、条件を通信へ出さない", () => {
		const registry = new UiContributionRegistry();
		registry.registerUiContribution("test", () => [item]);
		expect(registry.resolve(initialState(), context).items).toEqual([
			{ id: "quota", slot: "status", control: item.control },
		]);
		for (const different of [
			{ ...context, backend: "codex" as const },
			{ ...context, provider: "anthropic" },
			{ ...context, provider: null },
			{ ...context, capabilities: [] },
		]) {
			expect(registry.resolve(initialState(), different).items).toEqual(
				[],
			);
		}
	});
	it("重複登録・重複IDを拒否し、解除は後続の同名登録に影響しない", () => {
		const registry = new UiContributionRegistry();
		const remove = registry.registerUiContribution("source", () => [item]);
		expect(() =>
			registry.registerUiContribution("source", () => []),
		).toThrow();
		remove();
		registry.registerUiContribution("source", () => [item]);
		remove();
		expect(registry.resolve(initialState(), context).items).toHaveLength(1);
		registry.registerUiContribution("another", () => [item]);
		expect(() => registry.resolve(initialState(), context)).toThrow();
	});
	it("order・ID順に並べ、公開値の変更から登録元を保護する", () => {
		const registry = new UiContributionRegistry();
		registry.registerUiContribution("source", () => [
			{ ...item, id: "z", order: 3 },
			{ ...item, id: "b" },
			{ ...item, id: "a" },
		]);
		const result = registry.resolve(initialState(), context);
		expect(result.items.map((entry) => entry.id)).toEqual(["a", "b", "z"]);
		result.items[0]!.control = {
			type: "progress",
			label: "changed",
			value: 0,
		};
		expect(
			registry.resolve(initialState(), context).items[0]!.control,
		).toEqual(item.control);
	});
	it("Piには実設定だけを公開し、Codexの互換枠とtier値はHostで生成する", () => {
		const registry = createBuiltinUiRegistry();
		const state = initialState();
		state.configOptions = [
			{
				id: "model",
				name: "Model",
				currentValue: "claude",
				options: [{ value: "claude", name: "Claude" }],
			},
		];
		expect(
			registry.resolve(state, context).items.map((entry) => entry.id),
		).toEqual(["config:model"]);
		state.configOptions.push({
			id: "service_tier",
			name: "Service",
			currentValue: "priority",
			options: [
				{ value: "priority", name: "Fast" },
				{ value: "default", name: "Default" },
			],
		});
		const codex = registry.resolve(state, { ...context, backend: "codex" });
		expect(codex.items).toHaveLength(5);
		expect(codex.items.at(-1)?.control).toMatchObject({
			type: "toggle",
			checked: true,
			onValue: "priority",
			offValue: "default",
		});
		state.configOptions.push({
			id: "fast-mode",
			name: "Fast mode",
			currentValue: "on",
			options: [
				{ value: "on", name: "On" },
				{ value: "off", name: "Off" },
			],
		});
		const aliases = registry.resolve(state, {
			...context,
			backend: "codex",
		});
		expect(
			aliases.items.filter((entry) => entry.control.type === "toggle"),
		).toHaveLength(1);
		expect(aliases.items.at(-1)?.control).toMatchObject({
			configId: "fast-mode",
			onValue: "on",
			checked: true,
		});
	});
});

describe("UI Contribution通信", () => {
	it("Pi Controllerが実行中モデルのproviderで解決し、再接続・無効化で再評価する", async () => {
		const h = piHarness();
		let provider = "openai-codex";
		Object.defineProperty(h.runtime, "model", {
			get: () => ({ provider, id: "demo" }),
		});
		/** 内部登録を追加した `Controller` で実際のライフサイクルを通す。 */
		class Controller extends PiSessionController {
			register() {
				this.uiRegistry.registerUiContribution("test", () => [
					{
						...item,
						when: {
							backend: "pi",
							provider: "openai-codex",
							capability: "model",
						},
					},
				]);
			}
		}
		const controller = new Controller(h.factory);
		controller.register();
		try {
			expect(controller.snapshot().uiContributions).toEqual({
				surface: "pi",
				items: [],
			});
			await controller.connect();
			expect(
				controller
					.snapshot()
					.uiContributions?.items.some(
						(entry) => entry.id === "quota",
					),
			).toBe(true);
			provider = "anthropic";
			await controller.connect();
			expect(
				controller
					.snapshot()
					.uiContributions?.items.some(
						(entry) => entry.id === "quota",
					),
			).toBe(false);
			controller.invalidate();
			expect(controller.snapshot().uiContributions).toEqual({
				surface: "pi",
				items: [],
			});
		} finally {
			await controller.dispose();
			await h.controller.dispose();
		}
	});
	it("未対応control、未解決条件、不正候補・数値を拒否する", () => {
		const valid = {
			surface: "pi",
			items: [
				{
					id: "test",
					slot: "status",
					control: { type: "progress", label: "Quota", value: 0 },
				},
			],
		};
		expect(isUiContributions(valid)).toBe(true);
		for (const value of [-1, 101, Infinity, NaN, "50"]) {
			expect(
				isUiContributions({
					...valid,
					items: [
						{
							...valid.items[0],
							control: { ...valid.items[0]!.control, value },
						},
					],
				}),
			).toBe(false);
		}
		for (const change of [
			{ slot: "unknown" },
			{ when: {} },
			{ order: Infinity },
			{ control: { type: "react", component: "code" } },
			{
				control: {
					type: "toggle",
					label: "x",
					configId: "x",
					checked: true,
					onValue: "on",
					offValue: "on",
				},
			},
			{
				control: {
					type: "select",
					option: {
						id: "x",
						name: "x",
						currentValue: "x",
						options: [
							{ value: "x", name: "x" },
							{ value: "x", name: "duplicate" },
						],
					},
				},
			},
		]) {
			expect(
				isUiContributions({
					...valid,
					items: [{ ...valid.items[0], ...change }],
				}),
			).toBe(false);
		}
		expect(isState({ ...initialState(), uiContributions: valid })).toBe(
			true,
		);
		expect(
			isState({
				...initialState(),
				uiContributions: { ...valid, surface: "unknown" },
			}),
		).toBe(false);
	});
	it("config変更・resetをsnapshotとpatchの両方に反映する", () => {
		/** テストから正本の更新だけを公開する。 */
		class State extends SessionState {
			update(value: Partial<ChatState>) {
				this.patch(value);
			}
		}
		const session = new State();
		const events: unknown[] = [];
		session.subscribe((event) => events.push(event));
		expect(session.snapshot().uiContributions?.surface).toBe("codex");
		session.update({
			configOptions: [
				{
					id: "model",
					name: "Model",
					currentValue: "new",
					options: [{ value: "new", name: "New" }],
				},
			],
		});
		expect(events.at(-1)).toMatchObject({
			type: "state/patch",
			patch: { uiContributions: session.snapshot().uiContributions },
		});
		expect(
			session
				.snapshot()
				.uiContributions?.items.find(
					(entry) => entry.id === "config:model",
				)?.control,
		).toMatchObject({ option: { currentValue: "new" } });
		session.update(initialState());
		expect(isState(session.snapshot())).toBe(true);
		expect(
			session
				.snapshot()
				.uiContributions?.items.find(
					(entry) => entry.id === "config:model",
				)?.control,
		).toMatchObject({ option: { currentValue: "" } });
	});
});

// 解決済み UI の通信スキーマを定義し、Host 内部の条件型に依存させない。
import * as z from "zod";
import {
	ConfigChoiceSchema,
	ConfigOptionSchema,
	IdSchema,
	QuotaWindowSchema,
} from "./composerSchemas";

/** 宣言型 UI 境界だけで識別子長と候補値の一意性を要求する。 */
export const UiConfigOptionSchema = ConfigOptionSchema.extend({
	id: IdSchema,
	options: z.array(ConfigChoiceSchema.extend({ value: IdSchema })),
}).refine(
	(option) =>
		new Set(option.options.map((choice) => choice.value)).size ===
		option.options.length,
	{
		message: "Duplicate option values",
		path: ["options"],
	},
);

const controlFields = {
	disabled: z.boolean().optional(),
	description: z.string().optional(),
};

/** 利用枠は未取得の `null` や空配列を表示コントロールとして送らない。 */
export const QuotaControlSchema = z.object({
	...controlFields,
	type: z.literal("quota"),
	windows: z.array(QuotaWindowSchema).min(1),
});

/** 選択操作は既存の `config/set` に接続する。 */
export const SelectControlSchema = z.object({
	...controlFields,
	type: z.literal("select"),
	option: UiConfigOptionSchema,
});

/** アイコンと段階選択、特定の段階で表示する追加設定をまとめる。 */
export const SliderCardControlSchema = z.object({
	...controlFields,
	type: z.literal("slider-card"),
	option: UiConfigOptionSchema,
	icon: z.enum(["shield", "shield-alert", "model"]),
	model: UiConfigOptionSchema.optional(),
	fastMode: z
		.object({
			configId: IdSchema,
			checked: z.boolean(),
			onValue: IdSchema,
			offValue: IdSchema,
			disabled: z.boolean().optional(),
		})
		.optional(),
	warning: z.boolean().optional(),
	secondary: z
		.object({
			option: UiConfigOptionSchema,
			icon: z.enum(["user", "bot"]),
		})
		.optional(),
});

/** 切替の送信値が同一になる定義を拒否する。 */
export const ToggleControlSchema = z
	.object({
		...controlFields,
		type: z.literal("toggle"),
		configId: IdSchema,
		label: z.string(),
		checked: z.boolean(),
		onValue: IdSchema,
		offValue: IdSchema,
	})
	.refine((control) => control.onValue !== control.offValue, {
		message: "Toggle values must differ",
		path: ["offValue"],
	});

/** 進捗は有限の百分率に限定する。 */
export const ProgressControlSchema = z.object({
	...controlFields,
	type: z.literal("progress"),
	label: z.string(),
	value: z.number().min(0).max(100),
});

/** 種別ごとの構造と検証を一箇所へ集約する。 */
export const UiControlSchema = z.discriminatedUnion("type", [
	QuotaControlSchema,
	SelectControlSchema,
	SliderCardControlSchema,
	ToggleControlSchema,
	ProgressControlSchema,
]);

/** 配置可能な領域の型を列挙値から導出する。 */
export const UiSlotSchema = z.enum([
	"settings.main",
	"settings.advanced",
	"model.header",
	"composer.toolbar",
	"status",
]);

/** `when` は省略または `undefined` だけを許可し、未解決条件を拒否する。 */
export const ResolvedUiContributionSchema = z.object({
	id: IdSchema,
	slot: UiSlotSchema,
	order: z.number().optional(),
	when: z.never().optional(),
	control: UiControlSchema,
});

/** バックエンドの設定領域と、ID が重複しない解決済み宣言。 */
export const UiContributionsSchema = z
	.object({
		surface: z.enum(["codex", "pi"]),
		items: z.array(ResolvedUiContributionSchema),
	})
	.refine(
		(value) =>
			new Set(value.items.map((item) => item.id)).size ===
			value.items.length,
		{
			message: "Duplicate contribution IDs",
			path: ["items"],
		},
	);

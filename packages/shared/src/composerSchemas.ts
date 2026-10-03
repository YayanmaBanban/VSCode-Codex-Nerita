// チャット入力欄と宣言型 UI で共有する通信データの構造を定義する。
import * as z from "zod";

/** 既存 `isId` と同じ UTF-16 コード単位で通信用識別子を制限する。 */
export const IdSchema = z
	.string()
	.refine((value) => value.length > 0 && value.length <= 256);

/** サーバーが提供する選択肢の表示名と送信値。 */
export const ConfigChoiceSchema = z.object({
	value: z.string(),
	name: z.string(),
	description: z.string().optional(),
	icon: z.enum(["user", "bot"]).optional(),
});

/** 候補から隠された現在値も `currentLabel` で表示できる設定。 */
export const ConfigOptionSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().optional(),
	currentValue: z.string(),
	currentLabel: z.string().optional(),
	options: z.array(ConfigChoiceSchema),
});

/** 利用枠の残量の割合と、表示用のリセット情報。 */
export const QuotaWindowSchema = z.object({
	label: z.string(),
	remaining: z.number().min(0).max(100),
	detail: z.string(),
	source: z.literal("codex-login").optional(),
});

/** チャット入力欄の設定検証では、設定と選択肢の `description` を検証対象に含めない。 */
export const ComposerConfigOptionsSchema = z.array(
	ConfigOptionSchema.omit({ description: true }).extend({
		options: z.array(ConfigChoiceSchema.omit({ description: true })),
	}),
);

/** `null` は未取得を表し、取得済みの利用枠には最低1件必要。 */
export const ComposerQuotaSchema = z.array(QuotaWindowSchema).min(1).nullable();

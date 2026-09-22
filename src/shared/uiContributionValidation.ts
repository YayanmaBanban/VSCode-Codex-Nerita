// 宣言型UIの通信Schemaで検証し、未知キーを含む元の値を保持する。
import { UiContributionsSchema } from "./uiContributionSchemas";
import type { UiContributions } from "./uiContributions";

/** parse結果へ置換せず、従来どおり検証の成否だけを返す。 */
export function isUiContributions(value: unknown): value is UiContributions {
	return UiContributionsSchema.safeParse(value).success;
}

// Host が解決した宣言型 UI だけを Webview へ渡す。実行コードや任意の CSS は含めない。
import type { BackendId } from "./backend";
import type { z } from "zod";
import type {
	UiSlotSchema,
	UiControlSchema,
	ResolvedUiContributionSchema,
	UiContributionsSchema,
} from "./uiContributionSchemas";

/** 初期版で配置できる表示領域。 */
export type NeritaUiSlot = z.infer<typeof UiSlotSchema>;

/** バックエンドとプロバイダーを独立に指定し、すべての条件を Host で照合する。 */
export type ContributionCondition = {
	backend?: BackendId;
	provider?: string;
	capability?: string;
};

/** 操作は既存の検証済み `config/set` へ接続する。 */
export type NeritaUiControl = z.infer<typeof UiControlSchema>;

/** Registry への登録形式。条件そのものは Webview へ送らない。 */
export type NeritaUiContribution = {
	id: string;
	slot: NeritaUiSlot;
	order?: number;
	when?: ContributionCondition;
	control: NeritaUiControl;
};

/** Host で表示条件を解決した通信形式。 */
export type ResolvedUiContribution = z.infer<
	typeof ResolvedUiContributionSchema
>;

/** バックエンド固有の Surface と、その内側に配置する宣言。 */
export type UiContributions = z.infer<typeof UiContributionsSchema>;

// Hostが解決した宣言型UIだけをWebviewへ渡す。実行コードや任意のCSSは含めない。
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

/** backendとproviderを独立に指定し、すべての条件をHostで照合する。 */
export type ContributionCondition = {
	backend?: BackendId;
	provider?: string;
	capability?: string;
};

/** 操作は既存の検証済みconfig/setへ接続する。 */
export type NeritaUiControl = z.infer<typeof UiControlSchema>;

/** Registryへの登録形式。条件そのものはWebviewへ送らない。 */
export type NeritaUiContribution = {
	id: string;
	slot: NeritaUiSlot;
	order?: number;
	when?: ContributionCondition;
	control: NeritaUiControl;
};

/** Hostで表示条件を解決した通信形式。 */
export type ResolvedUiContribution = z.infer<
	typeof ResolvedUiContributionSchema
>;

/** backend固有のSurfaceと、その内側に配置する宣言。 */
export type UiContributions = z.infer<typeof UiContributionsSchema>;

// Host が解決した Contribution の設定操作を各表示部品へ渡す。
import type { UiContributions } from "@nerita/shared/uiContributions";
/** 設定値はこのコールバックを通して Host へ要求する。 */
export type ContributionSlotProps = {
	contributions: UiContributions;
	disabled: boolean;
	onChange: (configId: string, value: string) => void;
};

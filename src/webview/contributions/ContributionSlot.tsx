// Host で選別された Contribution を指定 `slot` へ安定した順序で配置する。
import type {
	NeritaUiSlot,
	UiContributions,
} from "../../shared/uiContributions";
import { ContributionRenderer } from "./ContributionRenderer";

/** `slot` 共通の操作先。バックエンド固有の判定は含めない。 */
export type ContributionSlotProps = {
	contributions: UiContributions;
	disabled: boolean;
	onChange: (configId: string, value: string) => void;
};

/** Host の登録順に依存せず `order` と ID で描画順を決める。 */
export function ContributionSlot({
	name,
	contributions,
	...props
}: ContributionSlotProps & { name: NeritaUiSlot }) {
	return (
		<>
			{contributions.items
				.filter((item) => item.slot === name)
				.sort(
					(a, b) =>
						(a.order ?? 0) - (b.order ?? 0) ||
						a.id.localeCompare(b.id),
				)
				.map((item) => (
					<ContributionRenderer
						key={item.id}
						control={item.control}
						{...props}
					/>
				))}
		</>
	);
}

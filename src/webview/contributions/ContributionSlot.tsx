// Hostで選別されたContributionを指定slotへ安定した順序で配置する。
import type {
	NeritaUiSlot,
	UiContributions,
} from "../../shared/uiContributions";
import { ContributionRenderer } from "./ContributionRenderer";

/** slot共通の操作先。backend固有の判定は含めない。 */
export type ContributionSlotProps = {
	contributions: UiContributions;
	disabled: boolean;
	onChange: (configId: string, value: string) => void;
};

/** Hostの登録順に依存せずorderとIDで描画順を決める。 */
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

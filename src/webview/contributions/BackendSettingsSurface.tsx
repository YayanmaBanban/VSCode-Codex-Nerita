// backendごとの設定領域を分離し、内側の項目は同じ宣言型slotで描画する。
import {
	ContributionSlot,
	type ContributionSlotProps,
} from "./ContributionSlot";

/** Codex App Serverの設定面。認証操作は既存Headerで管理する。 */
export function CodexSettingsSurface(props: ContributionSlotProps) {
	return (
		<div className="contents" data-settings-surface="codex">
			<ContributionSlot name="settings.main" {...props} />
			<ContributionSlot name="settings.advanced" {...props} />
		</div>
	);
}

/** Piの設定面。内部Registryの項目を同じslotで扱う。 */
export function PiSettingsSurface(props: ContributionSlotProps) {
	return (
		<div className="contents" data-settings-surface="pi">
			<ContributionSlot name="settings.main" {...props} />
			<ContributionSlot name="settings.advanced" {...props} />
		</div>
	);
}

const surfaces = { codex: CodexSettingsSurface, pi: PiSettingsSurface };

/** provider差分はHostが解決済み。ここでは大枠のSurfaceだけを選ぶ。 */
export function BackendSettingsSurface(props: ContributionSlotProps) {
	const Surface = surfaces[props.contributions.surface];
	return <Surface {...props} />;
}

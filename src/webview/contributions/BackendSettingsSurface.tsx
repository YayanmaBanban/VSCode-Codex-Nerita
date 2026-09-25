// バックエンドごとの設定領域を分離し、内側の項目は同じ宣言型 `slot` で描画する。
import {
	ContributionSlot,
	type ContributionSlotProps,
} from "./ContributionSlot";

/** Codex App Server の設定面。認証操作は既存 Header で管理する。 */
export function CodexSettingsSurface(props: ContributionSlotProps) {
	return (
		<div className="contents" data-settings-surface="codex">
			<ContributionSlot name="settings.main" {...props} />
			<ContributionSlot name="settings.advanced" {...props} />
		</div>
	);
}

/** Pi の設定面。内部 Registry の項目を同じ `slot` で扱う。 */
export function PiSettingsSurface(props: ContributionSlotProps) {
	return (
		<div className="contents" data-settings-surface="pi">
			<ContributionSlot name="settings.main" {...props} />
			<ContributionSlot name="settings.advanced" {...props} />
		</div>
	);
}

const surfaces = { codex: CodexSettingsSurface, pi: PiSettingsSurface };

/** プロバイダー差分は Host が解決済み。ここでは大枠の Surface だけを選ぶ。 */
export function BackendSettingsSurface(props: ContributionSlotProps) {
	const Surface = surfaces[props.contributions.surface];
	return <Surface {...props} />;
}

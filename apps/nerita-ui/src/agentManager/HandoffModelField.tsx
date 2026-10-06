// 選択済みモデル名で候補を絞らず、再選択時も全モデルを表示する。
import type { ManagerModel } from "@nerita/shared/agentManager/messages";
import { Field, inputStyle, ModelOptions } from "./Fields";

/** 未接続時の保存済みモデルは保持し、モデル変更では推論値を勝手に書き換えない。 */
export function HandoffModelField({
	label,
	value,
	models,
	onChange,
}: {
	label: string;
	value: string;
	models: ManagerModel[];
	onChange: (value: string) => void;
}) {
	return (
		<Field label={label}>
			<select
				aria-label={label}
				className={inputStyle}
				required
				value={value}
				onChange={(event) => onChange(event.target.value)}
			>
				<option value="">モデルを選択</option>
				<ModelOptions value={value} models={models} />
			</select>
		</Field>
	);
}

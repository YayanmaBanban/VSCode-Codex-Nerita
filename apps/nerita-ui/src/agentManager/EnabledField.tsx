// 有効・無効・未指定の三値を区別する共通の入力部品。
import { Field, inputStyle } from "./Fields";

/** 未指定と明示的な有効化を区別し、未指定では保存側が設定キーを削除する。 */
export function EnabledField({
	value,
	onChange,
}: {
	value: boolean | undefined;
	onChange: (value: boolean | undefined) => void;
}) {
	let selected = "inherit";
	if (value !== undefined) {
		selected = value ? "disabled" : "enabled";
	}
	return (
		<Field label="有効／無効">
			<select
				className={inputStyle}
				value={selected}
				onChange={(event) =>
					onChange(
						event.target.value === "inherit"
							? undefined
							: event.target.value === "disabled",
					)
				}
			>
				<option value="inherit">未指定（バックエンドに任せる）</option>
				<option value="enabled">Enabled</option>
				<option value="disabled">Disabled</option>
			</select>
		</Field>
	);
}

// ACP の設定を平坦化し、接続時のモデル・モード ID と表示値を揃える。
import type {
	NewSessionResponse,
	SessionConfigOption,
} from "@agentclientprotocol/sdk";
import type { ConfigOption } from "../../shared/composer";
import { isRecord } from "../../shared/validation";

/** 未対応の設定型を除き、グループ化された選択肢も name を保持する。 */
export function configOptions(
	options: SessionConfigOption[] = [],
): ConfigOption[] {
	return options.flatMap((option) =>
		option.type !== "select"
			? []
			: [
					{
						id: option.id,
						name: option.name,
						currentValue: option.currentValue,
						...(option.description
							? { description: option.description }
							: {}),
						options: option.options
							.flatMap((value) =>
								"options" in value ? value.options : [value],
							)
							.map((value) => ({
								value: value.value,
								name: value.name,
								...(value.description
									? { description: value.description }
									: {}),
							})),
					},
				],
	);
}

/** 初期値は現行 ID を優先し、選択肢が一致しない場合は currentValue を使う。 */
export function initialConfig(session: NewSessionResponse): ConfigOption[] {
	// models は旧形式の追加フィールドのため、SDK の型に依存せず検証する。
	const models =
		"models" in session && isRecord(session.models) ? session.models : {};
	const model =
		typeof models.currentModelId === "string"
			? models.currentModelId
			: undefined;
	const parts = model?.match(/^(.*)\[([^\]]+)\]$/);
	const values: Record<string, string | undefined> = {
		mode: session.modes?.currentModeId,
		model: parts?.[1] ?? model,
		reasoning_effort: parts?.[2],
	};
	return configOptions(session.configOptions ?? []).map((option) => {
		const value = values[option.id];
		return value && option.options.some((choice) => choice.value === value)
			? { ...option, currentValue: value }
			: option;
	});
}

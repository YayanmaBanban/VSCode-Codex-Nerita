// Pi のプロジェクト既定値だけを編集し、ユーザー設定や優先順位を変更しない。

import {
	piDefaultsSchema,
	piThinkingSchema,
	type PiDefaults,
} from "@nerita/shared/agentManager/config";
import { effortError, effortOptions } from "@nerita/shared/agentManager/effort";
import type { ManagerModel } from "@nerita/shared/agentManager/messages";
import { cn } from "cnfast";
import { useState, type Dispatch, type SetStateAction } from "react";
import {
	buttonStyle,
	EffortField,
	Field,
	inputStyle,
	ModelField,
} from "./Fields";
import type { ManagerSave } from "./useAgentManager";

/** Pi のプロジェクト既定値、モデル候補と保存操作。 */
type PiDefaultsSettingsProps = {
	defaults: PiDefaults;
	models: ManagerModel[];
	busy: boolean;
	save: ManagerSave;
};

/** 空欄は設定を削除し、0 は明示した上限として保存する。 */
export function PiDefaultsSettings({
	defaults,
	models,
	busy,
	save,
}: PiDefaultsSettingsProps) {
	const [edit, setEdit] = useState(defaults);
	const error = effortError(
		models,
		edit.defaultModel,
		edit.defaultThinking,
		defaults.defaultModel,
		defaults.defaultThinking,
	);
	return (
		<form
			className="grid gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				if (error) {
					return;
				}
				save({
					type: "defaults",
					defaults: piDefaultsSchema.parse(edit),
				});
			}}
		>
			<h2 className="m-0 text-lg font-semibold">Workspace defaults</h2>
			<PiDefaultsFields
				busy={busy}
				edit={edit}
				models={models}
				setEdit={setEdit}
				error={error}
			/>
			<p className="m-0 text-xs text-muted">
				保存先: .pi/settings.json。設定の優先順位は Pi 側に任せます。
			</p>
		</form>
	);
}

/** 編集中の Pi の既定値、モデル候補と入力エラー。 */
type PiDefaultsFieldsProps = {
	busy: boolean;
	edit: PiDefaults;
	models: ManagerModel[];
	setEdit: Dispatch<SetStateAction<PiDefaults>>;
	error: undefined | string;
};

/** 既定モデル・推論とセッション内の起動上限を編集する。 */
function PiDefaultsFields({
	busy,
	edit,
	models,
	setEdit,
	error,
}: PiDefaultsFieldsProps) {
	return (
		<fieldset
			disabled={busy}
			className="m-0 grid min-w-0 gap-4 border-0 p-0"
		>
			<ModelField
				value={edit.defaultModel}
				models={models}
				onChange={(defaultModel) => setEdit({ ...edit, defaultModel })}
			/>
			{(["defaultThinking", "maxThinking"] as const).map((key) => (
				<EffortField
					key={key}
					label={
						key === "defaultThinking"
							? "Default thinking"
							: "Max thinking"
					}
					value={edit[key]}
					options={
						key === "maxThinking"
							? piThinkingSchema.options
							: effortOptions(models, edit.defaultModel)
					}
					onChange={(value) =>
						setEdit(
							piDefaultsSchema.parse({
								...edit,
								[key]: value,
							}),
						)
					}
				/>
			))}
			<p className="m-0 text-xs text-muted">
				Max thinking
				はモデル共通の上限です。選択モデルに対応する推論候補とは異なります。
			</p>
			<Field label="セッション内の起動上限">
				<input
					className={inputStyle}
					type="number"
					min={0}
					max={100000}
					step={1}
					value={edit.maxSubagentSpawnsPerSession ?? ""}
					placeholder="未指定"
					onChange={(event) =>
						setEdit({
							...edit,
							maxSubagentSpawnsPerSession:
								event.target.value === ""
									? undefined
									: Number(event.target.value),
						})
					}
				/>
			</Field>
			<button
				disabled={!!error}
				className={cn(buttonStyle, "justify-self-start")}
				type="submit"
			>
				既定値を保存
			</button>
			{error && (
				<p role="alert" className="text-sm">
					{error}
				</p>
			)}
		</fieldset>
	);
}

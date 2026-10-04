// バックエンド別の設定を受け取り、名前・説明・本文と保存操作を共通化する。
import type { ReactNode } from "react";
import {
	agentEditSchema,
	type AgentEdit,
} from "@nerita/shared/agentManager/config";
import type {
	ManagedAgent,
	ManagerModel,
} from "@nerita/shared/agentManager/messages";
import { reasoningLabel } from "@nerita/shared/settingsCards";
import { Field, inputStyle, buttonStyle } from "./Fields";

/** 保存形式と固有の検証はバックエンド別画面が担当する。 */
type AgentSettingsProps = {
	agent?: ManagedAgent | undefined;
	models: ManagerModel[];
	edit: AgentEdit;
	onChange: (edit: AgentEdit) => void;
	busy: boolean;
	onSubmit: () => void;
	children: ReactNode;
	error?: string | undefined;
	filename?: string | undefined;
	onFilenameChange?: ((name: string) => void) | undefined;
};

/** 入力中は空の名前を許し、保存時にはスキーマを満たす値だけを送る。 */
export function AgentSettings(props: AgentSettingsProps) {
	const { agent, edit, busy, onSubmit, children, onChange } = props;
	const error =
		props.error ??
		(agentEditSchema.safeParse(edit).success
			? undefined
			: "名前と入力内容を確認してください。");
	return (
		<form
			className="grid gap-5"
			onSubmit={(event) => {
				event.preventDefault();
				if (!error) {
					onSubmit();
				}
			}}
		>
			<fieldset
				disabled={busy || agent?.editable === false}
				className="m-0 grid min-w-0 gap-5 border-0 p-0"
			>
				<AgentIdentityFields {...props} />
				<section className="grid gap-4 border-t border-input-border pt-4">
					<h3 className="m-0 text-sm font-semibold">Agent 設定</h3>
					{children}
				</section>
				<DefinitionField
					edit={edit}
					onChange={onChange}
					field="prompt"
					label="システムプロンプト"
					rows={10}
					limit={60000}
				/>
				{error && (
					<p role="alert" className="text-sm">
						{error}
					</p>
				)}
				<button
					type="submit"
					className={`${buttonStyle} justify-self-end`}
					disabled={!!error}
				>
					変更を保存
				</button>
			</fieldset>
		</form>
	);
}

/** 定義の出所と編集できるメタデータを表示する。 */
function AgentIdentityFields({
	agent,
	models,
	edit,
	onChange,
	filename,
	onFilenameChange,
}: AgentSettingsProps) {
	return (
		<>
			{edit.definition ? (
				<DefinitionField
					edit={edit}
					onChange={onChange}
					field="name"
					label="名前"
					limit={80}
				/>
			) : (
				<h2 className="m-0 text-lg font-semibold">{agent?.name}</h2>
			)}
			{onFilenameChange && (
				<Field label="ファイル名">
					<input
						className={inputStyle}
						required
						pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}"
						value={filename}
						onChange={(event) =>
							onFilenameChange(event.target.value)
						}
					/>
				</Field>
			)}
			{agent?.definitionPath && (
				<p className="m-0 text-xs break-all text-muted">
					{agent.definitionPath}
				</p>
			)}
			<DefinitionBadges agent={agent} models={models} />
			{edit.definition ? (
				<DefinitionField
					edit={edit}
					onChange={onChange}
					field="description"
					label="説明"
					rows={3}
					limit={2000}
				/>
			) : (
				<p className="m-0 text-sm text-muted">{agent?.description}</p>
			)}
			{agent?.unavailableReason && (
				<p role="status" className="text-sm text-muted">
					{agent.unavailableReason}
				</p>
			)}
		</>
	);
}

/** バッジは編集中の値ではなく、読み込んだ定義値を示す。 */
function DefinitionBadges({
	agent,
	models,
}: Pick<AgentSettingsProps, "agent" | "models">) {
	const model = agent?.definitionModel;
	const values = [
		agent?.source ?? "project",
		models.find((item) => item.value === model)?.name ??
			model ??
			"モデル未指定",
		agent?.definitionThinking
			? reasoningLabel(agent.definitionThinking)
			: "推論未指定",
	];
	return (
		<div className="flex flex-wrap gap-2 text-xs text-muted">
			{values.map((value, index) => (
				<span
					key={index}
					className="rounded border border-input-border px-2 py-1"
				>
					{value}
				</span>
			))}
		</div>
	);
}

/** 定義を持たないパッケージ・ユーザー由来の Agent には入力欄を作らない。 */
function DefinitionField({
	edit,
	onChange,
	field,
	label,
	rows,
	limit,
}: Pick<AgentSettingsProps, "edit" | "onChange"> & {
	field: "name" | "description" | "prompt";
	label: string;
	rows?: number;
	limit: number;
}) {
	const definition = edit.definition;
	if (!definition) {
		return null;
	}
	const input = {
		className: inputStyle,
		maxLength: limit,
		value: definition[field],
		onChange: (
			event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
		) =>
			onChange({
				...edit,
				definition: { ...definition, [field]: event.target.value },
			}),
	};
	return (
		<Field label={label}>
			{rows ? (
				<textarea {...input} rows={rows} />
			) : (
				<input {...input} required />
			)}
		</Field>
	);
}

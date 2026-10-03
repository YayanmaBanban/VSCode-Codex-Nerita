// 保存先ごとのプリセット選択・名前変更・指示文編集をまとめる。

import type {
	PersonalityMessage,
	PersonalityPreset,
	PersonalityScope,
} from "@nerita/shared/personality";
import { cn } from "cnfast";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { ConfigControl } from "../composer/ConfigControl";
import { InstructionEditor } from "./InstructionEditor";

/** 保存先ごとの性格設定、処理中の状態と設定要求の送信関数。 */
type PersonalityPaneProps = {
	scope: "global" | "workspace";
	settings: PersonalityScope;
	pending: boolean;
	send: (message: PersonalityMessage) => void;
};

/** 名前を変えた保存は複製、本文だけの変更は既存プリセットの更新として扱う。 */
export function PersonalityPane(props: PersonalityPaneProps) {
	const { scope, settings } = props;
	const title = scope === "global" ? "グローバル" : "ワークスペース";
	const [expanded, setExpanded] = useState(true);
	return (
		<section
			aria-label={title}
			className="border-0 border-t border-solid border-message-border py-[12px]"
		>
			<button
				type="button"
				aria-expanded={expanded}
				aria-controls={`personality-${scope}`}
				onClick={() => setExpanded(!expanded)}
				className={cn(
					"flex w-full items-center justify-between border-0 bg-transparent px-0",
					"py-[4px] text-inherit",
				)}
			>
				<span>{title}</span>
				{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
			</button>
			{/* 編集状態を保持したまま高さを変え、閉じた内容への操作を防ぐ。 */}
			<div
				id={`personality-${scope}`}
				inert={!expanded}
				aria-hidden={!expanded}
				className={cn(
					"grid transition-[grid-template-rows] duration-[220ms]",
					"ease-[cubic-bezier(0.22,1,0.36,1)]",
					"motion-reduce:transition-none",
					expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
				)}
			>
				<div className="min-h-0 overflow-hidden">
					<PaneEditor
						key={JSON.stringify(settings)}
						{...props}
						title={title}
					/>
				</div>
			</div>
		</section>
	);
}

/** 保存先の性格設定、見出しと編集中の設定を送る関数。 */
type PaneEditorProps = {
	scope: "global" | "workspace";
	settings: PersonalityScope;
	pending: boolean;
	send: (message: PersonalityMessage) => void;
	title: string;
};

/** 保存済み設定が変わる時だけ編集状態を初期化する。 */
function PaneEditor(props: PaneEditorProps) {
	const { scope, settings, pending, send, title } = props;
	const selected = settings.presets.find(
		(preset) => preset.name === settings.selected,
	);
	const initialText = initialPresetText(settings, selected);
	const [name, setName] = useState(selected?.name ?? "");
	const [text, setText] = useState(initialText);
	const locked = settings.configuredText !== null;
	const inputDisabled = locked || pending;
	const changedName = name.trim() !== selected?.name;
	const collision =
		changedName &&
		settings.presets.some((preset) => preset.name === name.trim());
	return (
		<div className="flex min-w-0 flex-col gap-[10px] pt-[8px]">
			<PersonalityPresetSelector
				scope={scope}
				title={title}
				settings={settings}
				inputDisabled={inputDisabled}
				send={send}
			/>
			<label className="flex flex-col gap-[5px] text-[12px]">
				プリセット名
				<input
					aria-label={`${title}のプリセット名`}
					value={name}
					maxLength={200}
					disabled={inputDisabled}
					onChange={(event) => setName(event.target.value)}
					className={cn(
						"min-w-0 rounded-[4px] border border-solid border-input-border bg-input",
						"px-[8px] py-[7px] text-input-text",
					)}
				/>
			</label>
			{locked && (
				<p className="m-0 text-[11px] text-muted">
					config.toml の developer_instructions
					を使用しています（変更不可）。
				</p>
			)}
			<InstructionEditor
				text={initialText}
				label={`${title}の指示`}
				disabled={inputDisabled}
				onChange={setText}
			/>
			{collision && (
				<p role="alert" className="m-0 text-[11px]">
					同名のプリセットが存在します。
				</p>
			)}
			{text.length > 100_000 && (
				<p role="alert">指示は100,000文字以内にしてください。</p>
			)}
			<SavePersonalityPreset
				locked={locked}
				{...props}
				name={name}
				collision={collision}
				text={text}
				changedName={changedName}
				initialText={initialText}
				selected={selected}
			/>
		</div>
	);
}

/** プリセットの編集前後の内容、名前の重複・保存可否と保存要求の送信関数。 */
type SavePersonalityPresetProps = {
	locked: boolean;
	pending: boolean;
	name: string;
	collision: boolean;
	text: string;
	changedName: boolean;
	initialText: string;
	send: (message: PersonalityMessage) => void;
	scope: "global" | "workspace";
	selected: undefined | PersonalityPreset;
};

/** 保存先のプリセット一覧と、選択要求の送信・入力制限の状態。 */
type PersonalityPresetSelectorProps = {
	scope: "global" | "workspace";
	title: string;
	settings: PersonalityScope;
	inputDisabled: boolean;
	send: (message: PersonalityMessage) => void;
};

/** 保存先のプリセット一覧から選択要求を送る。 */
function PersonalityPresetSelector({
	scope,
	title,
	settings,
	inputDisabled,
	send,
}: PersonalityPresetSelectorProps) {
	return (
		<ConfigControl
			inDialog
			option={{
				id: scope,
				name: `${title}のプリセット`,
				currentValue: settings.selected,
				options: [
					{ name: "なし", value: "" },
					...settings.presets.map((preset) => ({
						name: preset.name,
						value: preset.name,
					})),
				],
			}}
			disabled={inputDisabled}
			onChange={(name) =>
				send({
					type: "personality/select",
					scope,
					name,
					requestId: crypto.randomUUID(),
				})
			}
		/>
	);
}

/** 名前の変更と本文の更新を区別して保存要求を送る。 */
function SavePersonalityPreset({
	locked,
	pending,
	name,
	collision,
	text,
	changedName,
	initialText,
	send,
	scope,
	selected,
}: SavePersonalityPresetProps) {
	return (
		<div className="flex justify-end">
			<button
				type="button"
				disabled={savePresetDisabled(
					locked,
					pending,
					name,
					collision,
					text,
					changedName,
					initialText,
				)}
				onClick={() =>
					send({
						type: "personality/save",
						scope,
						name: name.trim(),
						text,
						originalName: selected?.name ?? "",
						requestId: crypto.randomUUID(),
					})
				}
			>
				{changedName ? "保存" : "更新"}
			</button>
		</div>
	);
}

/** 外部設定を優先して指示文の初期値を選ぶ。 */
function initialPresetText(
	settings: PersonalityScope,
	selected: PersonalityPreset | undefined,
) {
	return settings.configuredText ?? selected?.text ?? "";
}

/** プリセットの保存可否を編集内容とロック状態から判定する。 */
function savePresetDisabled(
	locked: boolean,
	pending: boolean,
	name: string,
	collision: boolean,
	text: string,
	changedName: boolean,
	initialText: string,
): boolean | undefined {
	return (
		locked ||
		pending ||
		!name.trim() ||
		collision ||
		text.length > 100000 ||
		(!changedName && text === initialText)
	);
}

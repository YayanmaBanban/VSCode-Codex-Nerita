// 保存先ごとのプリセット選択・名前変更・指示文編集をまとめる。
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type {
	PersonalityScope,
	PersonalityMessage,
} from "../../../shared/personality";
import { ConfigControl } from "../composer/ConfigControl";
import { InstructionEditor } from "./InstructionEditor";

/** 名前を変えた保存は複製、本文だけの変更は既存プリセットの更新として扱う。 */
export function PersonalityPane({
	scope,
	settings,
	pending,
	send,
}: {
	scope: "global" | "workspace";
	settings: PersonalityScope;
	pending: boolean;
	send: (message: PersonalityMessage) => void;
}) {
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
				className="flex w-full items-center justify-between border-0 bg-transparent px-0 py-[4px] text-inherit"
			>
				<span>{title}</span>
				{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
			</button>
			{/* 編集状態を保持したまま高さを変え、閉じた内容への操作を防ぐ。 */}
			<div
				id={`personality-${scope}`}
				inert={!expanded}
				aria-hidden={!expanded}
				className={`grid transition-[grid-template-rows] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
			>
				<div className="min-h-0 overflow-hidden">
					<PaneEditor
						key={JSON.stringify(settings)}
						scope={scope}
						settings={settings}
						pending={pending}
						send={send}
						title={title}
					/>
				</div>
			</div>
		</section>
	);
}

/** 保存済み設定が変わる時だけ編集状態を初期化する。 */
function PaneEditor({
	scope,
	settings,
	pending,
	send,
	title,
}: {
	scope: "global" | "workspace";
	settings: PersonalityScope;
	pending: boolean;
	send: (message: PersonalityMessage) => void;
	title: string;
}) {
	const selected = settings.presets.find(
		(preset) => preset.name === settings.selected,
	);
	const initialText = settings.configuredText ?? selected?.text ?? "";
	const [name, setName] = useState(selected?.name ?? "");
	const [text, setText] = useState(initialText);
	const locked = settings.configuredText !== null;
	const changedName = name.trim() !== selected?.name;
	const collision =
		changedName &&
		settings.presets.some((preset) => preset.name === name.trim());
	return (
		<div className="flex min-w-0 flex-col gap-[10px] pt-[8px]">
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
				disabled={locked || pending}
				onChange={(name) =>
					send({
						type: "personality/select",
						scope,
						name,
						requestId: crypto.randomUUID(),
					})
				}
			/>
			<label className="flex flex-col gap-[5px] text-[12px]">
				プリセット名
				<input
					aria-label={`${title}のプリセット名`}
					value={name}
					maxLength={200}
					disabled={locked || pending}
					onChange={(event) => setName(event.target.value)}
					className="min-w-0 rounded-[4px] border border-solid border-input-border bg-input px-[8px] py-[7px] text-input-text"
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
				disabled={locked || pending}
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
			<div className="flex justify-end">
				<button
					type="button"
					disabled={
						locked ||
						pending ||
						!name.trim() ||
						collision ||
						text.length > 100_000 ||
						(!changedName && text === initialText)
					}
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
		</div>
	);
}

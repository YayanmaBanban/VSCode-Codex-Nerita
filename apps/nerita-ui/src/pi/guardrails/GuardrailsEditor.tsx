// ガードレールの設定編集と、ツールを実行しない検査を同じ画面で提供する。

import {
	guardProbeSchema,
	type GuardBridge,
	type GuardProbe,
} from "@nerita/shared/guardrails/messages";
import { cn } from "cnfast";
import { type Dispatch, type SetStateAction, useState } from "react";
import { type ZodSafeParseResult } from "zod";
import "../../chat/chat.css";
import { guardrailsFormSchema } from "./formSchema";
import "./guardrails.css";
import { GuardrailsFeedback } from "./GuardrailsFeedback";
import { GuardrailsRules, buttonStyle, inputStyle } from "./GuardrailsRules";
import { GuardrailsSaveButton } from "./GuardrailsSaveButton";
import { useGuardrails } from "./useGuardrails";

/** ガードレール文書の通知・編集要求を送受信するブリッジ。 */
type GuardrailsEditorProps = { bridge: GuardBridge };

/** 入力途中の JSON も保持し、検査失敗で文書を上書きしない。 */
export function GuardrailsEditor({ bridge }: GuardrailsEditorProps) {
	const editor = useGuardrails(bridge);
	const [tab, setTab] = useState<"form" | "json">("form");
	const [probe, setProbe] = useState<GuardProbe>({
		tool: "read",
		input: ".env",
		cwd: ".",
	});
	let parsed;
	try {
		parsed = guardrailsFormSchema.safeParse(JSON.parse(editor.text));
	} catch {
		parsed = undefined;
	}
	if (!editor.state) {
		return <p className="p-5">ガードレール設定を読み込み中…</p>;
	}
	const status = documentStatus(editor.text, editor.state);
	return (
		<main
			className="guardrails-editor text-foreground"
			data-document-status={status}
		>
			<GuardrailsEditorHeader
				editor={editor}
				state={editor.state}
				status={status}
				probe={probe}
			/>
			<div className="guardrails-panes">
				<GuardrailsRulePane
					tab={tab}
					setTab={setTab}
					editor={editor}
					parsed={parsed}
				/>
				<GuardrailsProbePane
					editor={editor}
					probe={probe}
					setProbe={setProbe}
				/>
			</div>
		</main>
	);
}

/** ガードレール文書の保存・適用状態と、検査対象・編集操作。 */
type GuardrailsEditorHeaderProps = {
	editor: ReturnType<typeof useGuardrails>;
	state: NonNullable<ReturnType<typeof useGuardrails>["state"]>;
	status: string;
	probe: GuardProbe;
};

/** 保存・適用操作を文書の状態に応じて提供する。 */
function GuardrailsEditorHeader({
	editor,
	state,
	status,
	probe,
}: GuardrailsEditorHeaderProps) {
	return (
		<header className="guardrails-header">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h1 className="m-0 text-xl font-semibold">Pi ガードレール</h1>
			</div>
			<p className="mb-0 text-[12px] break-all text-muted">
				{state.root} / .pi/guardrails.json
			</p>

			<p className="m-0 text-[13px] text-muted">
				保存した設定は「適用」で実行に反映します。検査ではファイル操作やコマンドを実行しません。
			</p>
			<div className="flex flex-wrap gap-2">
				<GuardrailsSaveButton
					dirty={status === "未保存"}
					busy={editor.busy}
					onSave={() => editor.request("save", probe)}
				/>
				<button
					className={cn(buttonStyle, "border-focus")}
					disabled={editor.busy || state.dirty}
					onClick={() => editor.request("apply", probe)}
				>
					適用
				</button>
			</div>
		</header>
	);
}

/** ガードレールの検査対象・結果と、検査条件の編集操作。 */
type GuardrailsProbePaneProps = {
	editor: ReturnType<typeof useGuardrails>;
	probe: GuardProbe;
	setProbe: Dispatch<SetStateAction<GuardProbe>>;
};

/** 副作用を起こさない検査の入力と判定結果を表示する。 */
function GuardrailsProbePane({
	editor,
	probe,
	setProbe,
}: GuardrailsProbePaneProps) {
	return (
		<section
			className="guardrails-pane guardrails-simulation"
			aria-label="判定シミュレーション"
		>
			<div className="guardrails-pane-heading">
				<h2 className="m-0 text-[14px]">判定シミュレーション</h2>
				<button
					className={buttonStyle}
					disabled={editor.busy}
					onClick={() => editor.request("check", probe)}
				>
					検査
				</button>
			</div>
			<div className="guardrails-scroll flex flex-col gap-3">
				<GuardrailsProbeTarget probe={probe} setProbe={setProbe} />
				<label>
					対象パス / コマンド
					<textarea
						className={cn(
							inputStyle,
							"min-h-20 resize-y font-editor",
						)}
						value={probe.input}
						maxLength={32768}
						onChange={(event) =>
							setProbe({
								...probe,
								input: event.target.value,
							})
						}
					/>
				</label>
				<p className="m-0 text-[12px] text-muted">
					Shellの動的なパスやスクリプト内部は完全には解析できません。判定不能な範囲は承認時にも表示します。
				</p>
				<GuardrailsFeedback reply={editor.reply} />
			</div>
		</section>
	);
}

/** フォーム・JSON の表示切り替え、文書の編集状態と解析結果。 */
type GuardrailsRulePaneProps = {
	tab: "form" | "json";
	setTab: Dispatch<SetStateAction<"form" | "json">>;
	editor: ReturnType<typeof useGuardrails>;
	parsed:
		| ZodSafeParseResult<{
				version: 1;
				pathAccess: {
					outsideRead: "allow" | "ask" | "deny";
					outsideWrite: "deny";
				};
				pathRules: {
					base: "workspace" | "home";
					match: "glob" | "file" | "directory";
					action: "allow" | "ask" | "deny";
					id: string;
					reason: string;
					pattern: string;
					exceptions: string[];
					operations: ("read" | "write")[];
				}[];
				commandRules: {
					shell: "powershell" | "pwsh" | "bash" | "any";
					match: "contains";
					action: "allow" | "ask" | "deny";
					id: string;
					reason: string;
					pattern: string;
				}[];
		  }>
		| undefined;
};

/** 検査するツール・作業ディレクトリと、検査条件を更新する関数。 */
type GuardrailsProbeTargetProps = {
	probe: GuardProbe;
	setProbe: Dispatch<SetStateAction<GuardProbe>>;
};

/** 検査するツールと作業ディレクトリを選ぶ。 */
function GuardrailsProbeTarget({
	probe,
	setProbe,
}: GuardrailsProbeTargetProps) {
	return (
		<div className={cn("grid grid-cols-1 gap-3", "sm:grid-cols-2")}>
			<label>
				Tool
				<select
					className={inputStyle}
					value={probe.tool}
					onChange={(event) =>
						setProbe({
							...probe,
							tool: guardProbeSchema.shape.tool.parse(
								event.target.value,
							),
						})
					}
				>
					{[
						"read",
						"ls",
						"write",
						"edit",
						"powershell",
						"pwsh",
						"bash",
						"extension",
					].map((tool) => (
						<option key={tool}>{tool}</option>
					))}
				</select>
			</label>
			<label>
				cwd（workspace基準）
				<input
					className={inputStyle}
					value={probe.cwd}
					maxLength={4096}
					onChange={(event) =>
						setProbe({
							...probe,
							cwd: event.target.value,
						})
					}
				/>
			</label>
		</div>
	);
}

/** フォームと JSON の編集を切り替え、競合時の再読込を提供する。 */
function GuardrailsRulePane({
	tab,
	setTab,
	editor,
	parsed,
}: GuardrailsRulePaneProps) {
	return (
		<section className="guardrails-pane" aria-label="ルール設定">
			<div className="guardrails-pane-heading">
				<div className="flex items-center gap-3">
					<span>ルール編集</span>
					<button
						type="button"
						role="switch"
						aria-label="JSONで編集"
						aria-checked={tab === "json"}
						className="guardrails-mode-switch"
						onClick={() => setTab(tab === "form" ? "json" : "form")}
					>
						<span />
					</button>
					<span>JSON</span>
				</div>
			</div>
			<div className="guardrails-scroll">
				<fieldset
					disabled={editor.locked}
					className="m-0 min-w-0 border-0 p-0"
				>
					{tab === "form" && parsed?.success === true ? (
						<GuardrailsRules
							config={parsed.data}
							onChange={(config) =>
								editor.change(
									`${JSON.stringify(config, null, 2)}\n`,
								)
							}
						/>
					) : (
						<div className="flex flex-col gap-2">
							{tab === "form" && (
								<p role="alert" className="m-0 text-warning">
									設定形式を確認してください。JSONを修正するとルール編集に戻れます。
								</p>
							)}
							<label htmlFor="guardrails-json">設定JSON</label>
							<textarea
								id="guardrails-json"
								maxLength={131072}
								spellCheck={false}
								className={cn(
									inputStyle,
									"min-h-80 resize-y font-editor text-[12px]",
								)}
								value={editor.text}
								onChange={(event) =>
									editor.change(event.target.value)
								}
							/>
						</div>
					)}
				</fieldset>
				{editor.conflict && (
					<button
						className={cn(buttonStyle, "self-start")}
						onClick={editor.reload}
					>
						編集を破棄して再読込
					</button>
				)}
			</div>
		</section>
	);
}

/** 入力途中と未適用を区別し、保存だけで適用済みと表示しない。 */
function documentStatus(
	text: string,
	state: { dirty: boolean; text: string; activeText: string },
): string {
	if (state.dirty || text !== state.text) {
		return "未保存";
	}
	try {
		return JSON.stringify(JSON.parse(text)) ===
			JSON.stringify(JSON.parse(state.activeText))
			? "適用済み"
			: "保存済み・未適用";
	} catch {
		return "保存済み・未適用";
	}
}

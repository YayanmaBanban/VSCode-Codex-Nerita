// 設定編集と実行しない検査を、エディタグループ内の一画面で提供する。
import { GuardrailsFeedback } from "./GuardrailsFeedback";
import { GuardrailsSaveButton } from "./GuardrailsSaveButton";
import "./guardrails.css";
import { useState } from "react";
import "../../chat/chat.css";
import type {
	GuardBridge,
	GuardProbe,
} from "../../../shared/guardrails/messages";
import { guardrailsFormSchema } from "./formSchema";
import { GuardrailsRules, buttonStyle, inputStyle } from "./GuardrailsRules";
import { useGuardrails } from "./useGuardrails";

/** 入力途中の JSON も保持し、検査失敗で文書を上書きしない。 */
export function GuardrailsEditor({ bridge }: { bridge: GuardBridge }) {
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
			<header className="guardrails-header">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h1 className="m-0 text-xl font-semibold">
						Pi ガードレール
					</h1>
				</div>
				<p className="mb-0 break-all text-[12px] text-muted">
					{editor.state.root} / .pi/guardrails.json
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
						className={`${buttonStyle} border-focus`}
						disabled={editor.busy || editor.state.dirty}
						onClick={() => editor.request("apply", probe)}
					>
						適用
					</button>
				</div>
			</header>
			<div className="guardrails-panes">
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
								onClick={() =>
									setTab(tab === "form" ? "json" : "form")
								}
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
							{tab === "form" && parsed?.success ? (
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
										<p
											role="alert"
											className="m-0 text-warning"
										>
											設定形式を確認してください。JSONを修正するとルール編集に戻れます。
										</p>
									)}
									<label htmlFor="guardrails-json">
										設定JSON
									</label>
									<textarea
										id="guardrails-json"
										maxLength={131072}
										spellCheck={false}
										className={`${inputStyle} min-h-80 resize-y font-editor text-[12px]`}
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
								className={`${buttonStyle} self-start`}
								onClick={editor.reload}
							>
								編集を破棄して再読込
							</button>
						)}
					</div>
				</section>
				<section
					className="guardrails-pane guardrails-simulation"
					aria-label="判定シミュレーション"
				>
					<div className="guardrails-pane-heading">
						<h2 className="m-0 text-[14px]">
							判定シミュレーション
						</h2>
						<button
							className={buttonStyle}
							disabled={editor.busy}
							onClick={() => editor.request("check", probe)}
						>
							検査
						</button>
					</div>
					<div className="guardrails-scroll flex flex-col gap-3">
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<label>
								Tool
								<select
									className={inputStyle}
									value={probe.tool}
									onChange={(event) =>
										setProbe({
											...probe,
											tool: event.target
												.value as GuardProbe["tool"],
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
						<label>
							対象パス / コマンド
							<textarea
								className={`${inputStyle} min-h-20 resize-y font-editor`}
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
			</div>
		</main>
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

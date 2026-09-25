// 検索可能な認証先一覧と、SDK から要求された入力をエディター内に表示する。
import { useState } from "react";
import "../chat/chat.css";
import { Check, ChevronRight, ChevronDown, Search } from "lucide-react";
import type {
	PiAuthState,
	PiAuthRequest,
	PiAuthPrompt,
	PiAuthItem,
} from "../../shared/piAuth";

/** 入力値は送信時・アンマウント時に破棄し、永続化しない。 */
function AuthInput({
	prompt,
	send,
}: {
	prompt: PiAuthPrompt;
	send: (request: PiAuthRequest) => void;
}) {
	const [value, setValue] = useState("");
	return (
		<form
			className="flex max-w-[560px] flex-col gap-[10px]"
			onSubmit={(event) => {
				event.preventDefault();
				if (value) {
					send({ type: "answer", id: prompt.id, value });
					setValue("");
				}
			}}
		>
			{prompt.options ? (
				<select
					id="auth-input"
					autoFocus
					value={value}
					onChange={(event) => setValue(event.target.value)}
					className="rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text"
				>
					<option value="">選択してください</option>
					{prompt.options.map((option) => (
						<option key={option.id} value={option.id}>
							{option.label}
						</option>
					))}
				</select>
			) : (
				<input
					id="auth-input"
					autoFocus
					type={prompt.secret ? "password" : "text"}
					autoComplete="off"
					spellCheck={false}
					value={value}
					title={prompt.message}
					placeholder={prompt.message}
					onChange={(event) => setValue(event.target.value)}
					className="min-w-0 rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
				/>
			)}
			<div className="flex flex-wrap items-baseline gap-[8px] mb-[16px]">
				<button type="submit" disabled={!value}>
					送信
				</button>
				<button
					type="button"
					onClick={() => send({ type: "cancel" })}
					className="border-alert-border bg-alert"
				>
					キャンセル
				</button>
			</div>
		</form>
	);
}

/** プロバイダーの認証方式をアコーディオンとして並べる。 */
export function PiAuthEditor({
	state,
	send,
}: {
	state: PiAuthState;
	send: (request: PiAuthRequest) => void;
}) {
	const [query, setQuery] = useState("");
	const [expanded, setExpanded] = useState<string | null>(null);
	const filtered = state.items.filter((item) =>
		`${item.name} ${item.id}`.toLowerCase().includes(query.toLowerCase()),
	);
	return (
		<main className="mx-auto w-full max-w-[960px] p-[20px] text-[13px]">
			<h1 className="mb-[8px] text-[22px] font-semibold">
				認証情報を管理
			</h1>
			<p className="mb-[24px] text-muted">
				認証先を選択して、APIキーやOAuthログインを設定します。
			</p>
			<label className="mb-[20px] flex items-center gap-[10px] rounded-[6px] border border-menu-border bg-menu px-[12px] text-menu-text">
				<Search size={16} aria-hidden="true" />
				<input
					aria-label="認証先を検索"
					placeholder="認証先を検索…"
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					className="min-w-0 flex-1 border-0 bg-transparent py-[12px] text-inherit outline-none"
				/>
			</label>
			<ul aria-label="認証先" className="m-0 list-none p-0">
				{filtered.map((item) => {
					const active = item.methods.some(
						(method) => method.id === state.active,
					);
					const open = expanded === item.id || active;
					const feedback = state.feedback?.[item.id];
					return (
						<li
							key={item.id}
							className="border-0 border-b border-solid border-message-border"
						>
							<button
								type="button"
								aria-expanded={open}
								aria-controls={`provider-${item.id}`}
								onClick={() =>
									setExpanded(open ? null : item.id)
								}
								className="flex w-full items-center gap-[12px] rounded-none border-0 bg-transparent px-[8px] py-[16px] text-left hover:bg-settings-hover"
							>
								{open ? (
									<ChevronDown size={18} aria-hidden="true" />
								) : (
									<ChevronRight
										size={18}
										aria-hidden="true"
									/>
								)}
								<span className="min-w-0 flex-1 break-words font-medium">
									{item.name}
								</span>
								{item.configured && (
									<Check
										size={18}
										className="shrink-0 text-[var(--vscode-testing-iconPassed,#3fb950)]"
										aria-label="設定済み"
									/>
								)}
							</button>
							{/* 閉じる間も内容を保持し、高さを補間する。閉じた内容は操作対象から外す。 */}
							<div
								id={`provider-${item.id}`}
								inert={!open}
								aria-hidden={!open}
								className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
							>
								<div className="min-h-0 overflow-hidden">
									<div className="pb-[20px] pl-[38px] pr-[8px]">
										{/* 通知領域の高さを確保し、表示・消去・折り返しで操作位置を動かさない。 */}
										{renderProviderFeedback(item, feedback)}
										<div className="flex flex-wrap gap-[8px]">
											{!active &&
												item.methods.map((method) => (
													<button
														key={method.id}
														type="button"
														disabled={
															state.active !==
															null
														}
														onClick={() =>
															send({
																type: "start",
																id: method.id,
															})
														}
													>
														{method.name}
													</button>
												))}
										</div>
										{active && state.prompt && (
											<div>
												<AuthInput
													key={state.prompt.id}
													prompt={state.prompt}
													send={send}
												/>
											</div>
										)}
									</div>
								</div>
							</div>
						</li>
					);
				})}
			</ul>
			{!filtered.length && (
				<p className="py-[24px] text-center text-muted">
					一致する認証先がありません。
				</p>
			)}
		</main>
	);
}

/** 認証先のエラーと進行状況の通知領域を表示する。 */
function renderProviderFeedback(
	item: PiAuthItem,
	feedback: { notice: string; error: string | null } | undefined,
) {
	return (
		<div
			aria-label={`${item.name}の通知`}
			className="mb-[12px] overflow-y-auto overscroll-contain"
		>
			{feedback?.error && (
				<p
					role="alert"
					className="m-0 break-words rounded-[6px] border border-alert-border bg-alert p-[12px] leading-[20px]"
				>
					{feedback.error}
				</p>
			)}
			{feedback?.notice && (
				<p
					role="status"
					className="m-0 break-words rounded-[6px] border border-tooltip-border bg-tooltip p-[12px] leading-[20px] gap-[8px]"
				>
					{feedback.notice}
				</p>
			)}
			{!feedback?.error && !feedback?.notice && (
				<p
					role="status"
					className="m-0 break-words rounded-[6px] border border-tooltip-border bg-tooltip p-[12px] leading-[20px] h-[40px]"
				/>
			)}
		</div>
	);
}

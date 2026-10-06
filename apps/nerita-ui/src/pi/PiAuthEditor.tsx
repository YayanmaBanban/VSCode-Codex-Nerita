// 検索可能な認証先一覧と、SDK から要求された入力をエディター内に表示する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";

import { type JSX, type Dispatch, type SetStateAction, useState } from "react";
import { useInitialFocus } from "../hooks/useInitialFocus";

import type {
	PiAuthItem,
	PiAuthPrompt,
	PiAuthRequest,
	PiAuthState,
} from "@nerita/shared/piAuth";
import { cn } from "cnfast";
import { Check, ChevronDown, ChevronRight, Search } from "lucide-react";

import "../chat/chat.css";

/** SDK が要求した認証入力と、入力値を送信する関数。 */
type AuthInputProps = {
	prompt: PiAuthPrompt;
	send: (request: PiAuthRequest) => void;
};

/** 入力値は送信時・アンマウント時に破棄し、永続化しない。 */
function AuthInput({ prompt, send }: AuthInputProps) {
	const inputRef = useInitialFocus<HTMLInputElement>(!prompt.options);
	const selectRef = useInitialFocus<HTMLSelectElement>(
		prompt.options !== undefined,
	);
	const [hasValue, setHasValue] = useState(false);
	return (
		<form
			className="flex max-w-[560px] flex-col gap-[10px]"
			onSubmit={(event) => {
				event.preventDefault();
				const field = inputRef.current ?? selectRef.current;
				const value = field?.value ?? "";
				if (field) {
					field.value = "";
				}
				setHasValue(false);
				if (value !== "") {
					send({ type: "answer", id: prompt.id, value });
				}
			}}
		>
			{prompt.options ? (
				<select
					id="auth-input"
					ref={selectRef}
					onChange={(event) =>
						setHasValue(Boolean(event.target.value))
					}
					className={cn(
						"rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text",
					)}
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
					type={prompt.secret ? "password" : "text"}
					autoComplete="off"
					spellCheck={false}
					ref={inputRef}
					title={prompt.message}
					placeholder={prompt.message}
					onChange={(event) =>
						setHasValue(Boolean(event.target.value))
					}
					className={cn(
						"min-w-0 rounded-[4px] border border-menu-border bg-menu p-[10px]",
						"text-menu-text outline-settings-focus",
					)}
				/>
			)}
			<div className="mb-[16px] flex flex-wrap items-baseline gap-[8px]">
				<button type="submit" disabled={!hasValue}>
					送信
				</button>
				<button
					type="button"
					onClick={() => {
						const field = inputRef.current ?? selectRef.current;
						if (field) {
							field.value = "";
						}
						setHasValue(false);
						send({ type: "cancel" });
					}}
					className="border-alert-border bg-alert"
				>
					キャンセル
				</button>
			</div>
		</form>
	);
}

/** Pi の認証先一覧・進行状態と、認証要求を送信する関数。 */
type PiAuthEditorProps = {
	state: PiAuthState;
	send: (request: PiAuthRequest) => void;
};

/** プロバイダーの認証方式をアコーディオンとして並べる。 */
export function PiAuthEditor({ state, send }: PiAuthEditorProps) {
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
			<label
				className={cn(
					"mb-[20px] flex items-center gap-[10px] rounded-[6px] border",
					"border-menu-border bg-menu px-[12px] text-menu-text",
				)}
			>
				<Search size={16} aria-hidden="true" />
				<input
					aria-label="認証先を検索"
					placeholder="認証先を検索…"
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					className={cn(
						"min-w-0 flex-1 border-0 bg-transparent py-[12px] text-inherit",
						"outline-none",
					)}
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
						<AuthProviderItem
							key={item.id}
							item={item}
							open={open}
							setExpanded={setExpanded}
							feedback={feedback}
							active={active}
							state={state}
							send={send}
						/>
					);
				})}
			</ul>
			{filtered.length === 0 && (
				<p className="py-[24px] text-center text-muted">
					一致する認証先がありません。
				</p>
			)}
		</main>
	);
}

/** 認証先の情報・通知・展開状態と、認証や展開を操作する関数。 */
type AuthProviderItemProps = {
	item: PiAuthItem;
	open: boolean;
	setExpanded: Dispatch<SetStateAction<string | null>>;
	feedback: undefined | { notice: string; error: string | null };
	active: boolean;
	state: PiAuthState;
	send: (request: PiAuthRequest) => void;
};

/** 認証先ごとの展開状態と認証操作を表示する。 */
function AuthProviderItem(props: AuthProviderItemProps): JSX.Element {
	const { item, open, setExpanded } = props;
	return (
		<li
			key={item.id}
			className="border-0 border-b border-solid border-message-border"
		>
			<button
				type="button"
				aria-expanded={open}
				aria-controls={`provider-${item.id}`}
				onClick={() => setExpanded(open ? null : item.id)}
				className={cn(
					"flex w-full items-center gap-[12px] rounded-none border-0 bg-transparent",
					"px-[8px] py-[16px] text-left",
					"hover:bg-settings-hover",
				)}
			>
				{open ? (
					<ChevronDown size={18} aria-hidden="true" />
				) : (
					<ChevronRight size={18} aria-hidden="true" />
				)}
				<span className="min-w-0 flex-1 font-medium break-words">
					{item.name}
				</span>
				{item.configured && (
					<Check
						size={18}
						className="shrink-0 text-menu-check"
						aria-label="設定済み"
					/>
				)}
			</button>
			{/* 閉じる間も内容を保持し、高さを補間する。閉じた内容は操作対象から外す。 */}
			<div
				id={`provider-${item.id}`}
				inert={!open}
				aria-hidden={!open}
				className={cn(
					"grid transition-[grid-template-rows] duration-200 ease-out",
					"motion-reduce:transition-none",
					open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
				)}
			>
				<div className="min-h-0 overflow-hidden">
					<AuthProviderContent {...props} />
				</div>
			</div>
		</li>
	);
}

/** 認証先の方式・通知・進行状態と、認証要求を送信する関数。 */
type AuthProviderContentProps = {
	item: PiAuthItem;
	feedback: undefined | { notice: string; error: string | null };
	active: boolean;
	state: PiAuthState;
	send: (request: PiAuthRequest) => void;
};

/** 認証方式の選択と進行中の入力・通知を表示する。 */
function AuthProviderContent({
	item,
	feedback,
	active,
	state,
	send,
}: AuthProviderContentProps) {
	return (
		<div className="pr-[8px] pb-[20px] pl-[38px]">
			{item.accounts?.map((account) => (
				<p key={account.id} className="text-muted">
					{account.active ? "使用中 · " : ""}
					{account.name} ·{" "}
					{account.mode === "session"
						? "このセッションのみ"
						: "VS Code に保存"}
				</p>
			))}
			{/* 通知領域の高さを確保し、表示・消去・折り返しで操作位置を動かさない。 */}
			{renderProviderFeedback(item, feedback)}
			<div className="flex flex-wrap gap-[8px]">
				{!active &&
					item.methods.map((method) => (
						<button
							key={method.id}
							type="button"
							disabled={state.active !== null}
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
			{isNonEmptyString(feedback?.error) && (
				<p
					role="alert"
					className={cn(
						"m-0 rounded-[6px] border border-alert-border bg-alert p-[12px]",
						"leading-[20px] break-words",
					)}
				>
					{feedback.error}
				</p>
			)}
			{isNonEmptyString(feedback?.notice) && (
				<p
					role="status"
					className={cn(
						"m-0 gap-[8px] rounded-[6px] border border-tooltip-border bg-tooltip",
						"p-[12px] leading-[20px] break-words",
					)}
				>
					{feedback.notice}
				</p>
			)}
			{!isNonEmptyString(feedback?.error) &&
				!isNonEmptyString(feedback?.notice) && (
					<p
						role="status"
						className={cn(
							"m-0 h-[40px] rounded-[6px] border border-tooltip-border bg-tooltip",
							"p-[12px] leading-[20px] break-words",
						)}
					/>
				)}
		</div>
	);
}

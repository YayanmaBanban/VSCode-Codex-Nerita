// 秘密値を含まない Binding と Provider の状態だけを扱う。秘密値の入力は Host の対話で行う。
import { useEffect, useState } from "react";
import {
	type CredentialBinding,
	type CredentialBridge,
	type CredentialReply,
	type CredentialRequest,
	type CredentialStorageMode,
} from "@nerita/shared/credentials";
import "../chat/chat.css";
import { BindingForm } from "./CredentialBindingForm";

type State = Extract<CredentialReply, { type: "state" }>;
/** Host の完了通知を待ち、UI だけで保存・削除が成功した状態にしない。 */
export function CredentialSettings({ bridge }: { bridge: CredentialBridge }) {
	const [state, setState] = useState<State>({
		type: "state",
		bindings: [],
		providers: [],
		busy: false,
	});
	const [notice, setNotice] = useState("");
	const [error, setError] = useState("");
	useEffect(() => {
		const stop = bridge.subscribe((reply) => {
			if (reply.type === "state") {
				setState(reply);
			} else if (reply.type === "error") {
				setError(reply.message);
				setNotice("");
			} else {
				setNotice(reply.message);
				setError("");
			}
		});
		bridge.postMessage({ type: "ready" });
		return stop;
	}, [bridge]);
	return (
		<CredentialEditor
			state={state}
			send={(request) => bridge.postMessage(request)}
			notice={notice}
			error={error}
		/>
	);
}

/** 参照 ID と適用先をフォームで指定し、任意 JSON の直接保存を提供しない。 */
export function CredentialEditor({
	state,
	send,
	notice = "",
	error = "",
}: {
	state: State;
	send: (request: CredentialRequest) => void;
	notice?: string;
	error?: string;
}) {
	const [editing, setEditing] = useState<CredentialBinding>();
	return (
		<main className="mx-auto w-full max-w-[960px] p-[20px] text-[13px]">
			<h1 className="mb-[8px] text-[22px] font-semibold">
				資格情報を管理
			</h1>
			<p className="mb-[20px] text-muted">
				Binding には秘密情報の参照と利用先を保存します。
			</p>
			{error && (
				<p
					role="alert"
					className="rounded-[6px] border border-alert-border bg-alert p-[12px]"
				>
					{error}
				</p>
			)}
			{notice && <p role="status">{notice}</p>}
			<ProviderSettings state={state} send={send} />
			<section aria-label="Binding">
				<h2 className="text-[16px] font-semibold">Binding</h2>
				{state.bindings.map((binding) => (
					<div
						key={binding.id}
						className="my-[12px] flex flex-wrap items-center gap-[8px] border-b border-message-border pb-[12px]"
					>
						<span className="min-w-0 flex-1 break-words">
							{binding.id} · {binding.match.target} ·{" "}
							{binding.provider.type}
						</span>
						<button
							disabled={state.busy}
							onClick={() => setEditing(binding)}
						>
							編集
						</button>
						<button
							disabled={state.busy}
							onClick={() =>
								send({ type: "delete-binding", id: binding.id })
							}
						>
							削除
						</button>
					</div>
				))}
				<button
					disabled={state.busy}
					onClick={() => setEditing(undefined)}
				>
					新しい Binding
				</button>
				<BindingForm
					key={editing?.id ?? "new"}
					binding={editing}
					busy={state.busy}
					save={(binding) => send({ type: "save-binding", binding })}
				/>
			</section>
		</main>
	);
}

/** 秘密値を表示せず、Provider の認証状態と保存方法を表示する。 */
function providerStatus(provider: State["providers"][number]) {
	const status = provider.available ? "利用可能" : "未導入";
	if (provider.id !== "bitwarden-secrets-manager") {
		return status;
	}
	const modes = {
		session: "このセッションのみ",
		"secret-storage": "VS Code に保存",
	};
	return `${status} · ${provider.authenticated ? "認証済み" : "未認証"} · ${provider.mode ? modes[provider.mode] : "未設定"}`;
}
/** BWS の認証は Host の秘密入力で設定する。 */
function ProviderSettings({
	state,
	send,
}: {
	state: State;
	send: (request: CredentialRequest) => void;
}) {
	const [mode, setMode] = useState<CredentialStorageMode>("secret-storage");
	const [accountId, setAccountId] = useState("default");
	return (
		<section aria-label="Provider" className="mb-[24px]">
			<h2 className="text-[16px] font-semibold">Provider</h2>
			<ProviderStates providers={state.providers} />
			<div className="mt-[12px] grid gap-[12px] sm:grid-cols-2">
				<label>
					マシンアカウント ID{" "}
					<input
						aria-label="マシンアカウント ID"
						className="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
						value={accountId}
						onChange={(event) => setAccountId(event.target.value)}
						disabled={state.busy}
					/>
				</label>
				<label className="mr-[8px]">
					保存方法{" "}
					<select
						className="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
						value={mode}
						disabled={state.busy}
						onChange={(event) =>
							setMode(event.target.value as CredentialStorageMode)
						}
					>
						<option value="session">このセッションのみ</option>
						<option value="secret-storage">VS Code に保存</option>
					</select>
				</label>
			</div>
			<div className="mt-[12px] flex flex-wrap gap-[8px]">
				<button
					disabled={state.busy}
					onClick={() =>
						send({
							type: "bws-login",
							accountId,
							mode,
						})
					}
				>
					Bitwarden の認証を設定
				</button>
				<button
					disabled={state.busy}
					onClick={() => send({ type: "bws-logout", accountId })}
				>
					Bitwarden の認証を削除
				</button>
				<button
					disabled={state.busy}
					onClick={() => send({ type: "migrate-pi" })}
				>
					既存 Pi 認証を移行
				</button>
				<button
					disabled={state.busy}
					onClick={() => send({ type: "migrate-mcp" })}
				>
					既存 MCP 認証を移行
				</button>
			</div>
		</section>
	);
}
/** マシンアカウントが複数ある場合も、ID と保存先を対応付けて表示する。 */
function ProviderStates({ providers }: { providers: State["providers"] }) {
	return providers.map((provider) => (
		<p
			key={`${provider.id}:${provider.accountId ?? ""}`}
			className="break-words"
		>
			{providerName(provider.id)}
			{provider.accountId && ` · ${provider.accountId}`} ·{" "}
			{providerStatus(provider)}
		</p>
	));
}
/** 画面上は取得元の名前を使い、保存用の Provider ID を表示名にしない。 */
function providerName(id: string) {
	const names: Record<string, string> = {
		git: "Git",
		npmrc: "npm 設定",
		"bitwarden-secrets-manager": "Bitwarden Secrets Manager",
	};
	return names[id] ?? id;
}

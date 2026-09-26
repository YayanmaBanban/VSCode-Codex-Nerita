// Agent の設定とハンドオフ設定を、バックエンド共通の管理画面で編集する。
import { useState } from "react";
import type { ManagerBridge } from "../../shared/agentManager/messages";
import { useAgentManager } from "./useAgentManager";
import { AgentBrowser } from "./AgentBrowser";
import { HandoffSettings } from "./HandoffSettings";
import { buttonStyle } from "./Fields";
import "../chat/chat.css";

/** 読込エラーがある場合も、再読込と他の設定への移動を残す。 */
export function AgentManager({ bridge }: { bridge: ManagerBridge }) {
	const editor = useAgentManager(bridge);
	const [tab, setTab] = useState<"agents" | "handoff">("agents");
	const state = editor.state;
	return (
		<main className="mx-auto grid w-full max-w-5xl gap-6 p-4 text-foreground sm:p-6">
			<header className="grid gap-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h1 className="m-0 text-xl font-semibold">Agent Manager</h1>
					<button
						className={buttonStyle}
						disabled={editor.busy}
						onClick={editor.reload}
					>
						再読み込み
					</button>
				</div>
				<p className="m-0 break-words text-sm text-muted">
					{state?.label ?? "設定を読み込み中…"}
				</p>
				<nav aria-label="管理対象" className="flex flex-wrap gap-2">
					{(
						[
							["agents", "Agents"],
							["handoff", "ハンドオフ"],
						] as const
					).map(([id, label]) => (
						<button
							key={id}
							className={buttonStyle}
							aria-pressed={tab === id}
							disabled={editor.busy}
							onClick={() => setTab(id)}
						>
							{label}
						</button>
					))}
				</nav>
			</header>
			{editor.error && (
				<p
					role="alert"
					className="m-0 break-words rounded-md border border-input-border p-3 text-sm"
				>
					{editor.error}
				</p>
			)}
			{editor.notice && (
				<p role="status" className="m-0 break-words text-sm">
					{editor.notice}
				</p>
			)}
			{state && tab === "handoff" && (
				<HandoffSettings
					key={state.generation}
					state={state}
					busy={editor.busy}
					save={editor.save}
				/>
			)}
			{state && tab === "agents" && (
				<AgentBrowser
					state={state}
					busy={editor.busy}
					save={editor.save}
					viewer={() => bridge.postMessage({ type: "viewer" })}
				/>
			)}
		</main>
	);
}

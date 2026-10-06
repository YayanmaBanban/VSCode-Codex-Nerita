// バックエンドに応じて管理画面を選び、タブ・選択・未保存入力を管理する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { RotateCw, UserPlus } from "lucide-react";
import { cn } from "cnfast";
import type { ManagerBridge } from "@nerita/shared/agentManager/messages";
import { useAgentManager, type ManagerSave } from "./useAgentManager";
import { HandoffSettings } from "./HandoffSettings";
import { CodexAgentManager } from "../codex/CodexAgentManager";
import { PiAgentManager } from "../pi/PiAgentManager";
import { SettingsTooltip } from "../chat/SettingsTooltip";
import { ActionNotice } from "../ui/ActionNotice";
import { buttonStyle } from "./Fields";
import "../chat/chat.css";

const headerActionStyle = cn(
	"inline-flex size-8 items-center justify-center rounded-md border-0 bg-transparent p-0",
	"focus-visible:outline-2 focus-visible:outline-focus enabled:hover:bg-settings-hover",
	"disabled:cursor-not-allowed disabled:opacity-50",
);

/** 保存失敗時は入力を維持し、破棄する移動だけを画面内で確認する。 */
export function AgentManager({ bridge }: { bridge: ManagerBridge }) {
	const editor = useAgentManager(bridge);
	const {
		tab,
		selected,
		pending,
		setPending,
		setDirty,
		navigate,
		save,
		setTab,
		setSelected,
	} = useManagerNavigation(editor);
	const state = editor.state;
	const BackendManager = backendManager(state);
	return (
		<main className="mx-auto grid w-full max-w-5xl gap-6 p-4 text-foreground sm:p-6">
			<ManagerHeader
				editor={editor}
				tab={tab}
				setTab={setTab}
				navigate={navigate}
				setSelected={setSelected}
				selected={selected}
			/>
			<DiscardChanges
				visible={!!pending}
				onCancel={() => setPending(null)}
				onDiscard={() => {
					setDirty(false);
					pending?.();
					setPending(null);
				}}
			/>
			{isNonEmptyString(editor.error) && (
				<p role="alert" className="m-0 text-sm break-words">
					{editor.error}
				</p>
			)}
			{editor.notice !== "" && (
				<p role="status" className="m-0 text-sm">
					{editor.notice}
				</p>
			)}
			{state?.errors.map((error, index) => (
				<p role="alert" key={index} className="m-0 text-sm break-words">
					{error}
				</p>
			))}
			{state && tab === "handoff" && (
				<div onChangeCapture={() => setDirty(true)}>
					<HandoffSettings
						key={`${state.activeBackend}:${editor.revision}`}
						state={state}
						busy={editor.busy}
						save={save}
					/>
				</div>
			)}
			{state && tab === "agents" && (
				<BackendManager
					key={`${state.activeBackend}:${editor.revision}`}
					state={state}
					busy={editor.busy}
					save={save}
					selected={selected}
					onSelect={(id) => {
						if (id !== selected) {
							navigate(() => setSelected(id));
						}
					}}
					onDirty={() => setDirty(true)}
				/>
			)}
		</main>
	);
}

/** 使用中のバックエンドに対応する管理画面のコンポーネントを選ぶ。 */
function backendManager(state: ReturnType<typeof useAgentManager>["state"]) {
	return state?.activeBackend === "pi" ? PiAgentManager : CodexAgentManager;
}

/** 選択と破棄確認を保存結果に同期する。 */
function useManagerNavigation(editor: ReturnType<typeof useAgentManager>) {
	const [tab, setTab] = useState<"agents" | "handoff">("agents");
	const [selected, setSelected] = useState("");
	const [dirty, setDirty] = useState(false);
	const [pending, setPending] = useState<(() => void) | null>(null);
	const savedSelection = useRef<string | undefined>(undefined);
	const state = editor.state;
	useEffect(() => {
		if (state) {
			setDirty(false);
			const saved = savedSelection.current;
			setSelected((current) => loadedSelection(state, saved ?? current));
			savedSelection.current = undefined;
		}
	}, [state]);
	const navigate = (action: () => void) => {
		if (dirty) {
			setPending(() => action);
		} else {
			action();
		}
	};
	const save: ManagerSave = (change) => {
		if (change.type === "createAgent") {
			savedSelection.current =
				change.backend === "codex"
					? `.codex/agents/${change.filename}.toml`
					: `pi:${change.edit.definition?.name}`;
		} else if (
			change.type === "agent" &&
			change.agentId.startsWith("pi:") &&
			change.edit.definition
		) {
			savedSelection.current = `pi:${change.edit.definition.name}`;
		}
		editor.save(change);
	};
	return {
		tab,
		selected,
		pending,
		setPending,
		setDirty,
		navigate,
		save,
		setTab,
		setSelected,
	};
}

/** バックエンドに依存しない基本操作を上部にまとめる。 */
function ManagerHeader({
	editor,
	tab,
	setTab,
	navigate,
	setSelected,
	selected,
}: {
	editor: ReturnType<typeof useAgentManager>;
	tab: "agents" | "handoff";
	setTab: (tab: "agents" | "handoff") => void;
	navigate: (action: () => void) => void;
	setSelected: (id: string) => void;
	selected: string;
}) {
	return (
		<header className="grid gap-3 border-b border-input-border pb-4">
			<h1 className="m-0 text-xl font-semibold">Agent Manager</h1>
			<p className="m-0 text-sm break-words text-muted">
				{editor.state?.label ?? "設定を読み込み中…"}
			</p>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<nav aria-label="管理対象" className="flex gap-2">
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
							onClick={() => {
								if (id !== tab) {
									navigate(() => setTab(id));
								}
							}}
						>
							{label}
						</button>
					))}
				</nav>
				<div className="flex items-center gap-2">
					<SettingsTooltip content="再読み込み">
						<button
							className={headerActionStyle}
							aria-label="再読み込み"
							disabled={editor.busy}
							onClick={() => navigate(editor.reload)}
						>
							<RotateCw size={16} aria-hidden="true" />
						</button>
					</SettingsTooltip>
					{tab === "agents" && (
						<SettingsTooltip content="新しいエージェントを追加">
							<button
								className={headerActionStyle}
								aria-label="新しいエージェントを追加"
								disabled={
									editor.busy ||
									!editor.state ||
									selected === "new"
								}
								onClick={() =>
									navigate(() => setSelected("new"))
								}
							>
								<UserPlus size={16} aria-hidden="true" />
							</button>
						</SettingsTooltip>
					)}
				</div>
			</div>
		</header>
	);
}

/** 読み込み後も選択中の項目を維持し、見つからない場合は先頭の Agent を選ぶ。 */
function loadedSelection(
	state: NonNullable<ReturnType<typeof useAgentManager>["state"]>,
	selected: string,
) {
	if (
		selected === "new" ||
		(selected === "defaults" && state.activeBackend === "pi")
	) {
		return selected;
	}
	const agents = state.agents.filter(
		(agent) => agent.backend === state.activeBackend,
	);
	return (
		agents.find((agent) => agent.id === selected)?.id ??
		agents[0]?.id ??
		"defaults"
	);
}

/** Webview 内で未保存入力を破棄する操作を確認する。 */
function DiscardChanges({
	visible,
	onCancel,
	onDiscard,
}: {
	visible: boolean;
	onCancel: () => void;
	onDiscard: () => void;
}) {
	return (
		<AnimatePresence>
			{visible && (
				<ActionNotice
					key="discard-changes"
					label="未保存の変更"
					title="未保存の変更"
					description="未保存の変更を破棄して移動しますか？"
					actions={[
						{
							id: "continue",
							name: "編集を続ける",
							onClick: onCancel,
						},
						{
							id: "discard",
							name: "変更を破棄",
							onClick: onDiscard,
						},
					]}
				/>
			)}
		</AnimatePresence>
	);
}

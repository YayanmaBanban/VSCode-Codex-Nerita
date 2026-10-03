// バックエンドと定義を選び、対応する設定フォームだけを表示する。

import { cn } from "cnfast";
import type {
	ManagedAgent,
	ManagerState,
} from "@nerita/shared/agentManager/messages";
import { type Dispatch, type SetStateAction, useState } from "react";
import { AgentSettings } from "./AgentSettings";
import { buttonStyle, Field, inputStyle } from "./Fields";
import { PiDefaultsSettings } from "./PiDefaultsSettings";
import type { ManagerSave } from "./useAgentManager";

type Props = {
	state: ManagerState;
	busy: boolean;
	save: ManagerSave;
	viewer: () => void;
};

/** 設定未指定のエージェントと、明示的に有効・無効を指定したエージェントを区別する。 */
function agentLabel(agent: ManagedAgent) {
	const source = agent.source === "extension" ? "package" : agent.source;
	let status = agent.backend === "codex" ? "標準定義" : "設定未指定";
	if (agent.edit.disabled === false) {
		status = "Enabled";
	}
	if (agent.edit.disabled === true) {
		status = "Disabled";
	}
	if (agent.unavailableReason) {
		status = "Unsupported";
	}
	return `${agent.name} · ${source} · ${status}`;
}

/** 定義がない環境でも `Workspace defaults` を編集できる。 */
export function AgentBrowser(props: Props) {
	const { state, busy } = props;
	const [backend, setBackend] = useState(state.activeBackend);
	const [selected, setSelected] = useState("defaults");
	const agents = state.agents.filter((item) => item.backend === backend);
	const agent = agents.find((item) => item.id === selected) ?? agents[0];
	const defaults = backend === "pi" && (selected === "defaults" || !agent);
	let selectedId = agent ? agent.id : "";
	selectedId = defaults ? "defaults" : selectedId;
	return (
		<>
			{state.errors.length > 0 && (
				<div
					role="alert"
					className="rounded-md border border-input-border p-3 text-sm break-words"
				>
					{state.errors.map((error, index) => (
						<p key={index}>{error}</p>
					))}
				</div>
			)}
			<AgentBrowserToolbar
				{...props}
				backend={backend}
				setBackend={setBackend}
				setSelected={setSelected}
			/>
			<p className="m-0 text-xs text-muted">
				設定値を編集して保存します。実行中の Agent は変更しません。
			</p>
			<Field label="編集対象">
				<select
					className={inputStyle}
					disabled={busy}
					value={selectedId}
					onChange={(event) => setSelected(event.target.value)}
				>
					{backend === "pi" && (
						<option value="defaults">Workspace defaults</option>
					)}
					{agents.map((item) => (
						<option key={item.id} value={item.id}>
							{agentLabel(item)}
						</option>
					))}
					{!agents.length && <option value="">Agent 定義なし</option>}
				</select>
			</Field>
			<section
				className={cn(
					"min-w-0 rounded-lg border border-input-border p-4",
					"sm:p-5",
				)}
			>
				<SelectedSettings
					{...props}
					backend={backend}
					defaults={defaults}
					agent={agent}
				/>
			</section>
			{backend === "pi" && (
				<details>
					<summary className="cursor-pointer text-sm">
						User 設定・Model scope（閲覧のみ）
					</summary>
					<pre className="overflow-auto text-xs">
						{state.piUserSettings}
					</pre>
					<pre className="overflow-auto text-xs">
						{state.modelScope}
					</pre>
				</details>
			)}
		</>
	);
}

/** バックエンドの選択状態と、定義選択・実行履歴を開く操作。 */
type AgentBrowserToolbarProps = {
	busy: boolean;
	backend: "pi" | "codex";
	setBackend: Dispatch<SetStateAction<"pi" | "codex">>;
	setSelected: Dispatch<SetStateAction<string>>;
	viewer: () => void;
	state: ManagerState;
};

/** バックエンドの選択と実行履歴への移動をまとめる。 */
function AgentBrowserToolbar({
	busy,
	backend,
	setBackend,
	setSelected,
	viewer,
	state,
}: AgentBrowserToolbarProps) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<div className="flex gap-2">
				{(["pi", "codex"] as const).map((id) => (
					<button
						key={id}
						className={buttonStyle}
						disabled={busy}
						aria-pressed={backend === id}
						onClick={() => {
							setBackend(id);
							setSelected("defaults");
						}}
					>
						{id === "pi" ? "Pi" : "Codex"}
					</button>
				))}
			</div>
			<button className={buttonStyle} onClick={viewer}>
				実行中 {state.running} / 履歴 {state.spawned} · チャットで確認
			</button>
		</div>
	);
}

/** 選択中の定義または既定値と、保存に必要な管理状態。 */
type SelectedSettingsProps = {
	state: ManagerState;
	backend: "pi" | "codex";
	defaults: boolean;
	agent: ManagedAgent | undefined;
	busy: boolean;
	save: ManagerSave;
};

/** 定義の選択や保存世代が変わったときにフォームを作り直し、編集の初期値を更新する。 */
function SelectedSettings(props: SelectedSettingsProps) {
	const { state, backend, defaults, agent, busy, save } = props;
	if (defaults) {
		return (
			<PiDefaultsSettings
				key={state.generation}
				defaults={state.piDefaults}
				models={state.models.pi}
				busy={busy}
				save={save}
			/>
		);
	}
	if (agent) {
		return (
			<AgentSettings
				key={`${agent.id}:${state.generation}`}
				{...props}
				agent={agent}
				models={state.models[backend]}
			/>
		);
	}
	return (
		<p className="text-sm break-words text-muted">
			.codex/agents/*.toml にある Agent 定義を表示します。
		</p>
	);
}

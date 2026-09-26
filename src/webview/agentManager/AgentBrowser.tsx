// バックエンドと定義を選び、対応する設定フォームだけを表示する。
import { useState } from "react";
import type {
	ManagedAgent,
	ManagerState,
} from "../../shared/agentManager/messages";
import type { ManagerSave } from "./useAgentManager";
import { AgentSettings } from "./AgentSettings";
import { PiDefaultsSettings } from "./PiDefaultsSettings";
import { buttonStyle, Field, inputStyle } from "./Fields";

type Props = {
	state: ManagerState;
	busy: boolean;
	save: ManagerSave;
	viewer: () => void;
};

/** 設定を未指定にした Agent と、明示的な無効を区別する。 */
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

/** 定義がない環境でも Workspace defaults を編集できる。 */
export function AgentBrowser({ state, busy, save, viewer }: Props) {
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
					className="break-words rounded-md border border-input-border p-3 text-sm"
				>
					{state.errors.map((error, index) => (
						<p key={index}>{error}</p>
					))}
				</div>
			)}
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
					実行中 {state.running} / 履歴 {state.spawned} ·
					チャットで確認
				</button>
			</div>
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
			<section className="min-w-0 rounded-lg border border-input-border p-4 sm:p-5">
				<SelectedSettings
					state={state}
					backend={backend}
					defaults={defaults}
					agent={agent}
					busy={busy}
					save={save}
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

/** 同じ種類のフォームでも、保存世代が変わったときだけ初期値を更新する。 */
function SelectedSettings({
	state,
	backend,
	defaults,
	agent,
	busy,
	save,
}: {
	state: ManagerState;
	backend: "pi" | "codex";
	defaults: boolean;
	agent: ManagedAgent | undefined;
	busy: boolean;
	save: ManagerSave;
}) {
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
				agent={agent}
				models={state.models[backend]}
				busy={busy}
				save={save}
			/>
		);
	}
	return (
		<p className="break-words text-sm text-muted">
			.codex/agents/*.toml にある Agent 定義を表示します。
		</p>
	);
}

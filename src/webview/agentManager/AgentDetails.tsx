// 定義の出所と編集値を分け、無効状態を三値で扱う。
import type { ManagedAgent } from "../../shared/agentManager/messages";
import { Field, inputStyle } from "./Fields";

/** 管理画面で表示するのは定義値であり、実効値と誤認させない。 */
export function AgentDetails({ agent }: { agent: ManagedAgent }) {
	const values = [
		["定義元", agent.source === "extension" ? "package" : agent.source],
		["定義のモデル", agent.definitionModel ?? "未指定"],
		["定義の推論", agent.definitionThinking ?? "未指定"],
		["別名", agent.aliases.join(", ") || "なし"],
	];
	if (agent.backend === "pi") {
		values.push(["Tools", agent.tools.join(", ") || "未指定"]);
	}
	return (
		<dl className="grid gap-2 break-words text-sm text-muted">
			{values.map(([label, value]) => (
				<div key={label}>
					<dt className="inline font-medium">{label}: </dt>
					<dd className="inline">{value}</dd>
				</div>
			))}
		</dl>
	);
}

/** 未指定は false と区別し、保存キーを削除する。 */
export function EnabledField({
	value,
	onChange,
}: {
	value: boolean | undefined;
	onChange: (value: boolean | undefined) => void;
}) {
	let selected = "inherit";
	if (value !== undefined) {
		selected = value ? "disabled" : "enabled";
	}
	return (
		<Field label="有効／無効">
			<select
				className={inputStyle}
				value={selected}
				onChange={(event) =>
					onChange(
						event.target.value === "inherit"
							? undefined
							: event.target.value === "disabled",
					)
				}
			>
				<option value="inherit">未指定（バックエンドに任せる）</option>
				<option value="enabled">Enabled</option>
				<option value="disabled">Disabled</option>
			</select>
		</Field>
	);
}

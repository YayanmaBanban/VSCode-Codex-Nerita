// グラフとフォームの編集内容を同じ定義に集約し、TOML へ変換する。
import { useEffect, useRef, useState } from "react";
import { stringify } from "smol-toml";
import {
	parseWorkflow,
	validateWorkflow,
	type Workflow,
} from "../../../shared/workflows/definition";
import {
	connectSteps,
	nextStep,
	removeStep,
	renameStep,
} from "./workflowModel";
import { WorkflowCanvas } from "./WorkflowCanvas";
import { WorkflowStepForm } from "./WorkflowStepForm";

/** 不完全な入力も保持し、検証エラーの修正をフォーム内で続けられるようにする。 */
export function WorkflowGraphEditor({
	initial,
	text,
	change,
}: {
	initial: Workflow;
	text: string;
	change: (text: string) => void;
}) {
	const [workflow, setWorkflow] = useState(initial);
	const [selected, setSelected] = useState(initial.steps[0]!.id);
	const [error, setError] = useState("");
	const written = useRef(text);
	const [externalInvalid, setExternalInvalid] = useState(false);
	useEffect(() => {
		if (
			written.current.replaceAll("\r\n", "\n") ===
			text.replaceAll("\r\n", "\n")
		) {
			return;
		}
		written.current = text;
		try {
			setWorkflow(parseWorkflow(text));
			setExternalInvalid(false);
		} catch {
			setExternalInvalid(true);
		}
	}, [text]);
	const update = (value: Workflow) => {
		setWorkflow(value);
		written.current = stringify(value);
		change(written.current);
		setError("");
	};
	const attempt = (operation: () => void) => {
		try {
			operation();
		} catch (error) {
			setError(String(error));
		}
	};
	const step =
		workflow.steps.find((item) => item.id === selected) ??
		workflow.steps[0]!;
	let validation = "";
	try {
		validateWorkflow(workflow);
	} catch (error) {
		validation = String(error);
	}
	if (externalInvalid) {
		return (
			<p role="alert" className="p-4">
				文書がグラフで扱えない内容に更新されました。TOML
				編集に切り替えて修正してください。
			</p>
		);
	}
	return (
		<div className="workflow-graph-layout grid min-h-0 flex-1">
			<div className="flex min-h-0 flex-col">
				<div className="flex flex-wrap items-center gap-3 border-b border-[var(--workflow-border)] p-3">
					<button
						disabled={workflow.steps.length >= 32}
						onClick={() => {
							const next = nextStep(workflow);
							update({
								...workflow,
								steps: [...workflow.steps, next],
							});
							setSelected(next.id);
						}}
					>
						＋ ステップを追加
					</button>
					<label className="workflow-inline">
						選択
						<select
							value={step.id}
							onChange={(event) =>
								setSelected(event.target.value)
							}
						>
							{workflow.steps.map((item) => (
								<option key={item.id} value={item.id}>
									{item.id}
								</option>
							))}
						</select>
					</label>
					<span className="text-xs opacity-70">
						右の端子から次のステップの左端子へ接続
					</span>
				</div>
				<div className="min-h-72 flex-1">
					<WorkflowCanvas
						workflow={workflow}
						selected={step.id}
						select={setSelected}
						connect={(connection) =>
							attempt(() =>
								update(
									connectSteps(
										workflow,
										connection.source,
										connection.target,
									),
								),
							)
						}
						disconnect={(edges) =>
							update({
								...workflow,
								steps: workflow.steps.map((item) => ({
									...item,
									depends_on: item.depends_on.filter(
										(dep) =>
											!edges.some(
												(edge) =>
													edge.source === dep &&
													edge.target === item.id,
											),
									),
								})),
							})
						}
					/>
				</div>
			</div>
			<aside className="workflow-inspector min-h-0 overflow-auto border-l border-[var(--workflow-border)] p-4">
				<details className="mb-5">
					<summary className="mb-3 cursor-pointer font-semibold">
						ワークフロー設定
					</summary>
					<div className="flex flex-col gap-3">
						<label>
							名前
							<input
								value={workflow.name}
								maxLength={80}
								onChange={(event) =>
									update({
										...workflow,
										name: event.target.value,
									})
								}
							/>
						</label>
						<div className="grid grid-cols-2 gap-2">
							<label>
								同時実行数
								<input
									type="number"
									min={1}
									max={4}
									value={workflow.limits.max_concurrency}
									onChange={(event) =>
										update({
											...workflow,
											limits: {
												...workflow.limits,
												max_concurrency: Number(
													event.target.value,
												),
											},
										})
									}
								/>
							</label>
							<label>
								制限時間（秒）
								<input
									type="number"
									min={1}
									max={3600}
									value={workflow.limits.timeout_ms / 1000}
									onChange={(event) =>
										update({
											...workflow,
											limits: {
												...workflow.limits,
												timeout_ms:
													Number(event.target.value) *
													1000,
											},
										})
									}
								/>
							</label>
						</div>
					</div>
				</details>
				<WorkflowStepForm
					key={step.id}
					step={step}
					workflow={workflow}
					change={(next) =>
						update({
							...workflow,
							steps: workflow.steps.map((item) =>
								item.id === step.id ? next : item,
							),
						})
					}
					rename={(id) =>
						attempt(() => {
							update(renameStep(workflow, step.id, id));
							setSelected(id);
						})
					}
					remove={() =>
						attempt(() => update(removeStep(workflow, step.id)))
					}
					output={(checked) =>
						update({
							...workflow,
							outputs: checked
								? [...workflow.outputs, step.id]
								: workflow.outputs.filter(
										(id) => id !== step.id,
									),
						})
					}
				/>
				{(error || validation) && (
					<p
						role="alert"
						className="mt-4 whitespace-pre-wrap break-words text-[var(--vscode-errorForeground,#f88)]"
					>
						{error || validation}
					</p>
				)}
			</aside>
		</div>
	);
}

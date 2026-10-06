// グラフとフォームの編集内容を同じ定義に集約し、TOML へ変換する。
import { errorText } from "@nerita/shared/errorText";
import {
	isNonEmptyString,
	nonEmptyString,
} from "@nerita/shared/valuePredicates";

import { cn } from "cnfast";
import {
	parseWorkflow,
	validateWorkflow,
	type Workflow,
} from "@nerita/shared/workflows/definition";
import type { Edge } from "@xyflow/react";
import {
	type Dispatch,
	type SetStateAction,
	useEffect,
	useRef,
	useState,
} from "react";
import { stringify } from "smol-toml";
import { WorkflowCanvas } from "./WorkflowCanvas";
import {
	connectSteps,
	nextStep,
	removeStep,
	renameStep,
} from "./workflowModel";
import { WorkflowStepForm } from "./WorkflowStepForm";

/** ワークフローの初期定義、現在の TOML と編集内容を通知する関数。 */
type WorkflowGraphEditorProps = {
	initial: Workflow;
	text: string;
	change: (text: string) => void;
};

/** 不完全な入力も保持し、検証エラーの修正をフォーム内で続けられるようにする。 */
export function WorkflowGraphEditor({
	initial,
	text,
	change,
}: WorkflowGraphEditorProps) {
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
			setError(errorText(error));
		}
	};
	const step =
		workflow.steps.find((item) => item.id === selected) ??
		workflow.steps[0]!;
	let validation = "";
	try {
		validateWorkflow(workflow);
	} catch (error) {
		validation = errorText(error);
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
			<WorkflowGraphPane
				workflow={workflow}
				update={update}
				setSelected={setSelected}
				step={step}
				attempt={attempt}
			/>
			<WorkflowInspector
				workflow={workflow}
				update={update}
				step={step}
				attempt={attempt}
				setSelected={setSelected}
				error={error}
				validation={validation}
			/>
		</div>
	);
}

/** ワークフロー定義と選択中のステップ、選択・編集操作とエラー処理。 */
type WorkflowGraphPaneProps = {
	workflow: Workflow;
	update: (value: Workflow) => void;
	setSelected: Dispatch<SetStateAction<string>>;
	step: Workflow["steps"][number];
	attempt: (operation: () => void) => void;
};

/** グラフ上のステップ選択・追加と依存関係の編集を提供する。 */
function WorkflowGraphPane({
	workflow,
	update,
	setSelected,
	step,
	attempt,
}: WorkflowGraphPaneProps) {
	return (
		<div className="flex min-h-0 flex-col">
			<div
				className={cn(
					"flex flex-wrap items-center gap-3 border-b border-[var(--workflow-border)]",
					"p-3",
				)}
			>
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
						onChange={(event) => setSelected(event.target.value)}
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
							steps: disconnectWorkflowSteps(workflow, edges),
						})
					}
				/>
			</div>
		</div>
	);
}

/** 削除した接続線に対応する依存だけを取り除く。 */
function disconnectWorkflowSteps(
	workflow: Workflow,
	edges: Edge[],
): Workflow["steps"][number][] {
	return workflow.steps.map((item) => ({
		...item,
		depends_on: item.depends_on.filter(
			(dep) => !workflowEdgeExists(edges, dep, item.id),
		),
	}));
}

/** 選択中のステップとワークフロー定義、編集操作と検証結果。 */
type WorkflowInspectorProps = {
	workflow: Workflow;
	update: (value: Workflow) => void;
	step: Workflow["steps"][number];
	attempt: (operation: () => void) => void;
	setSelected: Dispatch<SetStateAction<string>>;
	error: string;
	validation: string;
};

/** 選択したステップとワークフロー設定・検証結果を表示する。 */
function WorkflowInspector({
	workflow,
	update,
	step,
	attempt,
	setSelected,
	error,
	validation,
}: WorkflowInspectorProps) {
	return (
		<aside
			className={cn(
				"workflow-inspector min-h-0 overflow-auto border-l",
				"border-[var(--workflow-border)] p-4",
			)}
		>
			<WorkflowSettings workflow={workflow} update={update} />
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
							: workflow.outputs.filter((id) => id !== step.id),
					})
				}
			/>
			{(isNonEmptyString(error) || isNonEmptyString(validation)) && (
				<p
					role="alert"
					className="mt-4 break-words whitespace-pre-wrap text-tool-error"
				>
					{nonEmptyString(error) ?? validation}
				</p>
			)}
		</aside>
	);
}

/** ワークフロー全体の設定と、定義を更新する関数。 */
type WorkflowSettingsProps = {
	workflow: Workflow;
	update: (value: Workflow) => void;
};

/** ワークフロー名と実行数・制限時間を編集する。 */
function WorkflowSettings({ workflow, update }: WorkflowSettingsProps) {
	return (
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
											Number(event.target.value) * 1000,
									},
								})
							}
						/>
					</label>
				</div>
			</div>
		</details>
	);
}

/** 削除対象の線が依存先と対象ステップを結んでいるか確認する。 */
function workflowEdgeExists(edges: Edge[], source: string, target: string) {
	return edges.some(
		(edge) => edge.source === source && edge.target === target,
	);
}

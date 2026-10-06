// 選択ステップの実行条件と依存先をキーボードでも編集できるようにする。

import { type ReactNode, useState } from "react";

import type {
	Workflow,
	WorkflowStep,
} from "@nerita/shared/workflows/definition";

/** 同時に指定できない会話モードをフォームの選択値にする。 */
function contextMode(step: WorkflowStep) {
	if (step.resume !== undefined) {
		return "resume";
	}
	return step.fork !== undefined ? "fork" : "fresh";
}

/** 編集するステップと全体の定義、名前変更・削除・出力指定の操作。 */
type WorkflowStepFormProps = {
	step: WorkflowStep;
	workflow: Workflow;
	change: (step: WorkflowStep) => void;
	rename: (id: string) => void;
	remove: () => void;
	output: (checked: boolean) => void;
};

/** 会話の継続モードへ切り替える際には、競合するエージェント指定を取り除く。 */
export function WorkflowStepForm(props: WorkflowStepFormProps) {
	const { step, workflow, change, rename, remove, output } = props;
	const [id, setId] = useState(step.id);
	const mode = contextMode(step);
	const source = step.resume ?? step.fork ?? "";
	const switchMode = createContextModeChange(source, step, change);
	return (
		<section
			className="flex min-w-0 flex-col gap-3"
			aria-label="ステップ設定"
		>
			<div className="flex items-center justify-between gap-2">
				<h2 className="text-sm font-semibold">ステップ設定</h2>
				<button onClick={remove}>削除</button>
			</div>
			<label>
				ステップ ID
				<div className="flex gap-2">
					<input
						value={id}
						onChange={(event) => setId(event.target.value)}
					/>
					<button onClick={() => rename(id)}>変更</button>
				</div>
			</label>
			<WorkflowContextMode
				mode={mode}
				switchMode={switchMode}
				workflow={workflow}
				step={step}
			/>
			{mode !== "fresh" && (
				<WorkflowContextSource
					source={source}
					switchMode={switchMode}
					mode={mode}
					workflow={workflow}
					step={step}
				/>
			)}
			{mode !== "resume" && (
				<label>
					Agent
					<input
						value={step.agent ?? ""}
						maxLength={80}
						onChange={(event) =>
							change({ ...step, agent: event.target.value })
						}
						placeholder="worker / reviewer"
					/>
				</label>
			)}
			<label>
				タスク
				<textarea
					rows={7}
					value={step.task}
					maxLength={32768}
					onChange={(event) =>
						change({ ...step, task: event.target.value })
					}
					placeholder="{{ step.output }} で依存先の結果を参照"
				/>
			</label>
			<WorkflowStepGroup step={step} change={change} />
			<WorkflowDependencies {...props} />
			<label className="workflow-check">
				<input
					type="checkbox"
					checked={workflow.outputs.includes(step.id)}
					onChange={(event) => output(event.target.checked)}
				/>
				ワークフローの出力に含める
			</label>
		</section>
	);
}

/** 継続・複製元のステップと会話モード、参照元を切り替える操作。 */
type WorkflowContextSourceProps = {
	source: string;
	switchMode: (value: string, ref?: string) => void;
	mode: "resume" | "fork" | "fresh";
	workflow: Workflow;
	step: WorkflowStep;
};

/** 表示グループを編集するステップと、変更を通知する関数。 */
type WorkflowStepGroupProps = {
	step: WorkflowStep;
	change: (step: WorkflowStep) => void;
};

/** 実行条件に影響しない表示グループを編集する。 */
function WorkflowStepGroup({ step, change }: WorkflowStepGroupProps) {
	return (
		<label>
			グループ
			<input
				value={step.group ?? ""}
				maxLength={80}
				onChange={(event) =>
					change({ ...step, group: event.target.value })
				}
				placeholder="表示用の名前（任意）"
			/>
		</label>
	);
}

/** 会話モードの変更時に競合する指定を除き、参照元を依存先に追加する。 */
function createContextModeChange(
	source: string,
	step: WorkflowStep,
	change: (step: WorkflowStep) => void,
) {
	return (value: string, ref = source) => {
		const { resume: _resume, fork: _fork, agent: _agent, ...rest } = step;
		const dependency =
			ref !== "" && !rest.depends_on.includes(ref)
				? [...rest.depends_on, ref]
				: rest.depends_on;
		if (value === "resume") {
			change({ ...rest, resume: ref, depends_on: dependency });
		} else if (value === "fork") {
			change({
				...rest,
				agent: step.agent ?? "worker",
				fork: ref,
				depends_on: dependency,
			});
		} else {
			change({ ...rest, agent: step.agent ?? "worker" });
		}
	};
}

/** 継続または複製する会話のステップを選ぶ。 */
function WorkflowContextSource({
	source,
	switchMode,
	mode,
	workflow,
	step,
}: WorkflowContextSourceProps): ReactNode {
	return (
		<label>
			会話の継承元
			<select
				value={source}
				onChange={(event) => switchMode(mode, event.target.value)}
			>
				<option value="" disabled>
					選択してください
				</option>
				{workflow.steps
					.filter((item) => item.id !== step.id)
					.map((item) => (
						<option key={item.id} value={item.id}>
							{item.id}
						</option>
					))}
			</select>
		</label>
	);
}

/** 現在の会話モードとステップ、切り替え先の候補を持つワークフロー定義。 */
type WorkflowContextModeProps = {
	mode: "resume" | "fork" | "fresh";
	switchMode: (value: string, ref?: string) => void;
	workflow: Workflow;
	step: WorkflowStep;
};

/** 会話の新規作成・継続・複製を選ぶ。 */
function WorkflowContextMode({
	mode,
	switchMode,
	workflow,
	step,
}: WorkflowContextModeProps) {
	return (
		<label>
			コンテキスト
			<select
				value={mode}
				onChange={(event) =>
					switchMode(
						event.target.value,
						workflow.steps.find((item) => item.id !== step.id)
							?.id ?? "",
					)
				}
			>
				<option value="fresh">Fresh · 新しい会話</option>
				<option value="resume" disabled={workflow.steps.length < 2}>
					Resume · 会話を継続
				</option>
				<option value="fork" disabled={workflow.steps.length < 2}>
					Fork · 会話を複製
				</option>
			</select>
		</label>
	);
}

/** 編集するステップと全体の定義、依存先の変更を通知する関数。 */
type WorkflowDependenciesProps = {
	workflow: Workflow;
	step: WorkflowStep;
	change: (step: WorkflowStep) => void;
};

/** 先に完了するステップを依存先一覧で選ぶ。 */
function WorkflowDependencies({
	workflow,
	step,
	change,
}: WorkflowDependenciesProps) {
	return (
		<fieldset className="flex flex-col gap-2">
			<legend>先に完了するステップ</legend>
			{workflow.steps
				.filter((item) => item.id !== step.id)
				.map((item) => (
					<label className="workflow-check" key={item.id}>
						<input
							type="checkbox"
							checked={step.depends_on.includes(item.id)}
							onChange={(event) =>
								change({
									...step,
									depends_on: event.target.checked
										? [...step.depends_on, item.id]
										: step.depends_on.filter(
												(dep) => dep !== item.id,
											),
								})
							}
						/>
						{item.id}
					</label>
				))}
		</fieldset>
	);
}

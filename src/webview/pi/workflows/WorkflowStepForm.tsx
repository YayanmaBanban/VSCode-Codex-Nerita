// 選択ステップの実行条件と依存先をキーボードでも編集できるようにする。
import { useState } from "react";
import type {
	Workflow,
	WorkflowStep,
} from "../../../shared/workflows/definition";

/** 同時に指定できない会話モードをフォームの選択値にする。 */
function contextMode(step: WorkflowStep) {
	if (step.resume !== undefined) {
		return "resume";
	}
	return step.fork !== undefined ? "fork" : "fresh";
}

/** 継続元を切り替える際には競合する Agent 指定を取り除く。 */
export function WorkflowStepForm({
	step,
	workflow,
	change,
	rename,
	remove,
	output,
}: {
	step: WorkflowStep;
	workflow: Workflow;
	change: (step: WorkflowStep) => void;
	rename: (id: string) => void;
	remove: () => void;
	output: (checked: boolean) => void;
}) {
	const [id, setId] = useState(step.id);
	const mode = contextMode(step);
	const source = step.resume ?? step.fork ?? "";
	const switchMode = (value: string, ref = source) => {
		const { resume: _resume, fork: _fork, agent: _agent, ...rest } = step;
		const dependency =
			ref && !rest.depends_on.includes(ref)
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
			{mode !== "fresh" && (
				<label>
					会話の継承元
					<select
						value={source}
						onChange={(event) =>
							switchMode(mode, event.target.value)
						}
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

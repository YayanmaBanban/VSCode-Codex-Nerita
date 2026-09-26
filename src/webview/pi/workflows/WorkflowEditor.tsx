// 上部操作を固定し、グラフ・TOML・生成スクリプトを同じ文書で切り替える。
import { useState } from "react";
import type { WorkflowBridge } from "../../../shared/workflows/messages";
import {
	parseWorkflow,
	type Workflow,
} from "../../../shared/workflows/definition";
import { WorkflowGraphEditor } from "./WorkflowGraphEditor";
import { useWorkflow } from "./useWorkflow";
import {
	WorkflowToolbar,
	WorkflowFeedback,
	WorkflowError,
} from "./WorkflowToolbar";
import "./workflows.css";

/** 文書の解析失敗は TOML 編集へ案内し、入力を破棄しない。 */
function readGraph(text: string) {
	try {
		return parseWorkflow(text);
	} catch {
		return null;
	}
}

/** 実行中は定義を固定し、停止と承認画面への移動を残す。 */
export function WorkflowEditor({ bridge }: { bridge: WorkflowBridge }) {
	const editor = useWorkflow(bridge);
	const [mode, setMode] = useState<"graph" | "toml">("graph");
	const [initial, setInitial] = useState<Workflow | null>(null);
	const [generation, setGeneration] = useState(0);
	const parsed = readGraph(editor.text);
	const graph = initial ?? parsed;
	const locked = editor.locked;
	const switchMode = () => {
		if (mode === "graph") {
			setMode("toml");
		} else if (parsed) {
			setInitial(parsed);
			setGeneration((value) => value + 1);
			setMode("graph");
		}
	};
	return (
		<main className="workflow-editor flex h-screen min-h-0 flex-col text-[13px]">
			<WorkflowToolbar
				editor={editor}
				bridge={bridge}
				mode={mode}
				valid={!!parsed}
				switchMode={switchMode}
			/>
			<WorkflowError
				error={editor.reply?.error}
				reload={() => {
					editor.reload();
					setInitial(readGraph(editor.state?.text ?? ""));
					setGeneration((value) => value + 1);
				}}
			/>
			{editor.state && (
				<fieldset
					disabled={locked}
					inert={locked}
					className="flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0"
				>
					{mode === "graph" && graph ? (
						<WorkflowGraphEditor
							key={generation}
							initial={graph}
							text={editor.text}
							change={(value) => {
								setInitial(graph);
								editor.change(value);
							}}
						/>
					) : (
						<div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
							{!parsed && (
								<p role="status">
									TOML を修正するとグラフ編集を利用できます。
								</p>
							)}
							<label className="flex min-h-0 flex-1 flex-col gap-2">
								Workflow TOML
								<textarea
									className="min-h-60 flex-1 font-mono"
									spellCheck={false}
									value={editor.text}
									maxLength={262144}
									onChange={(event) =>
										editor.change(event.target.value)
									}
								/>
							</label>
						</div>
					)}
				</fieldset>
			)}
			<WorkflowFeedback editor={editor} />
		</main>
	);
}

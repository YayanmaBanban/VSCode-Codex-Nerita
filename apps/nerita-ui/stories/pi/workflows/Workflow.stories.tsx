// 実際のエディタを、文書とジョブだけを模した通信境界で確認する。
import { errorText } from "@nerita/shared/errorText";
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { stringify } from "smol-toml";
import { WorkflowEditor } from "../../../src/pi/workflows/WorkflowEditor";
import type {
	WorkflowBridge,
	WorkflowReply,
	WorkflowState,
	WorkflowRequest,
} from "@nerita/shared/workflows/messages";
import { parseWorkflow } from "@nerita/shared/workflows/definition";

const sample = stringify({
	version: 1,
	name: "implementation-review",
	outputs: ["fix"],
	limits: { max_concurrency: 3, timeout_ms: 600000 },
	steps: [
		{
			id: "implement",
			agent: "worker",
			task: "実装を進めてください",
			depends_on: [],
		},
		{
			id: "review",
			agent: "reviewer",
			fork: "implement",
			task: "実装の経緯を踏まえて確認してください。\n{{ implement.output }}",
			depends_on: ["implement"],
			group: "review",
		},
		{
			id: "tests",
			agent: "reviewer",
			task: "テストを確認してください。\n{{ implement.output }}",
			depends_on: ["implement"],
			group: "review",
		},
		{
			id: "fix",
			resume: "implement",
			task: "{{ review.output }}\n{{ tests.output }}",
			depends_on: ["review", "tests"],
		},
	],
});

// Host のコンパイラーが生成したサンプル応答。編集内容の検証には共有の定義だけを使う。
const sampleScript =
	'const results = Object.create(null);\nconst p0 = Promise.all([]).then(() => runs.run("implement", {task: "実装を進めてください",agent: "worker"})).then(result => { if (!result.ok) throw new Error(result.error || "Step failed"); results["implement"] = result; return result; });\nconst p1 = Promise.all([p0]).then(() => runs.run("review", {task: "実装の経緯を踏まえて確認してください。\\n" + results["implement"].output + "",agent: "reviewer",neritaFork: results["implement"].runId})).then(result => { if (!result.ok) throw new Error(result.error || "Step failed"); results["review"] = result; return result; });\nconst p2 = Promise.all([p0]).then(() => runs.run("tests", {task: "テストを確認してください。\\n" + results["implement"].output + "",agent: "reviewer"})).then(result => { if (!result.ok) throw new Error(result.error || "Step failed"); results["tests"] = result; return result; });\nconst p3 = Promise.all([p1,p2]).then(() => runs.run("fix", {task: "" + results["review"].output + "\\n" + results["tests"].output + "",resume: results["implement"].runId})).then(result => { if (!result.ok) throw new Error(result.error || "Step failed"); results["fix"] = result; return result; });\nconst settled = await Promise.allSettled([p0,p1,p2,p3]);\nconst failed = settled.find(item => item.status === "rejected"); if (failed) throw failed.reason;\nreturn {"fix": await p3};';

/** 編集バッファと表示用の実行フラグだけを保持する。 */
function mockBridge(invalid: boolean): WorkflowBridge {
	let state: WorkflowState = {
		type: "state",
		text: invalid ? "version = [" : sample,
		version: 1,
		dirty: false,
		file: ".pi/workflows/implementation-review.toml",
		running: false,
	};
	const listeners = new Set<(message: WorkflowReply) => void>();
	const post = (message: WorkflowReply) => {
		listeners.forEach((listener) => listener(message));
	};
	const handle = (message: Extract<WorkflowRequest, { id: number }>) => {
		const reply: Extract<WorkflowReply, { type: "reply" }> = {
			type: "reply",
			id: message.id,
			error: null,
			notice: "",
		};
		try {
			if (message.type === "edit") {
				state = {
					...state,
					text: message.text,
					dirty: true,
					version: state.version + 1,
				};
			} else if (message.type === "save") {
				state = { ...state, dirty: false };
				reply.notice = "保存しました。";
			} else {
				parseWorkflow(state.text);
				reply.script = sampleScript;
				if (message.type === "run") {
					state = { ...state, running: true };
				} else {
					reply.notice =
						"TOML と依存関係を検証しました。Agent と Pi の検証は実行開始時に行います。";
				}
			}
		} catch (error) {
			reply.error = errorText(error);
		}
		post(state);
		post(reply);
	};
	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		postMessage(message) {
			if (message.type === "ready") {
				post(state);
			} else if (message.type === "stop") {
				state = { ...state, running: false };
				post(state);
				post({
					type: "reply",
					id: 0,
					error: null,
					notice: "実行を停止しました。",
				});
			} else if ("id" in message) {
				handle(message);
			}
		},
	};
}

/** 無効な TOML からの復旧も実際のコンポーネントで試す。 */
function EditorStory({ invalid = false }: { invalid?: boolean }) {
	const bridge = useMemo(() => mockBridge(invalid), [invalid]);
	return <WorkflowEditor bridge={bridge} />;
}
const meta = {
	title: "Pi/Workflow",
	component: EditorStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof EditorStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Editor: Story = {};
export const Invalid: Story = { args: { invalid: true } };

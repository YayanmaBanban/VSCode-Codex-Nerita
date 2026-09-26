// 実際のエディタを、文書とジョブだけを模した通信境界で確認する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { stringify } from "smol-toml";
import { WorkflowEditor } from "../../../webview/pi/workflows/WorkflowEditor";
import type {
	WorkflowBridge,
	WorkflowReply,
	WorkflowState,
	WorkflowRequest,
} from "../../../shared/workflows/messages";
import { compileWorkflow } from "../../../shared/workflows/compiler";
import { parseWorkflow } from "../../../shared/workflows/definition";

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

/** 実行は停止されるまで保持し、承認待ちの UI 操作を観察する。 */
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
			if (message.version !== state.version) {
				throw new Error("文書が変更されました。");
			}
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
				reply.script = compileWorkflow(parseWorkflow(state.text));
				if (message.type === "run") {
					state = { ...state, running: true };
				} else {
					reply.notice =
						"TOML と依存関係を検証しました。Agent と Pi の検証は実行開始時に行います。";
				}
			}
		} catch (error) {
			reply.error = String(error);
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

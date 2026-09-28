// 専用エディターの編集・保存・検査を、ファイルを書き換えない通信モックで再現する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { GuardrailsEditor } from "../../../webview/pi/guardrails/GuardrailsEditor";
import { defaultGuardrails } from "../../../shared/guardrails/config";
import type {
	GuardBridge,
	GuardReply,
	GuardState,
} from "../../../shared/guardrails/messages";

/** 編集バッファを保持し、保存・適用・検査の固定応答を返す。永続化や判定は行わない。 */
function mockBridge() {
	// 検査結果は外部応答の例であり、入力から判定を再実装しない。
	const response = { inspectionError: null as string | null };
	const text = JSON.stringify(defaultGuardrails(), null, 2);
	let state: GuardState = {
		type: "state",
		text,
		version: 1,
		dirty: false,
		root: "workspace/project",
		activeText: text,
	};
	const listeners = new Set<(message: GuardReply) => void>();
	const post = (message: GuardReply) =>
		listeners.forEach((listener) => listener(message));
	return {
		response,
		subscribe(listener: Parameters<GuardBridge["subscribe"]>[0]) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		postMessage(message: Parameters<GuardBridge["postMessage"]>[0]) {
			if (message.type === "ready") {
				post(state);
				return;
			}
			const reply: Extract<GuardReply, { type: "reply" }> = {
				type: "reply",
				id: message.id,
				error: null,
				notice: "",
				result: null,
				warnings: [],
			};
			try {
				if (message.type === "check" && response.inspectionError) {
					throw new Error(response.inspectionError);
				}
				if (message.type === "edit") {
					state = {
						...state,
						text: message.text,
						version: state.version + 1,
						dirty: true,
					};
				} else {
					if (message.type === "save") {
						state = { ...state, dirty: false };
						reply.notice =
							"保存しました。実行に反映するには適用してください。";
					} else if (message.type === "apply") {
						state = { ...state, activeText: state.text };
						reply.notice =
							"適用しました。変更前の承認は失効しました。";
					} else {
						reply.notice =
							"設定と入力例を検査しました。操作は実行していません。";
						reply.result = {
							action: "deny",
							reasons: ["秘密値を含む可能性があるファイルです。"],
							rules: ["env-files"],
							paths: ["workspace/project/.env"],
							uncertainties: [],
						};
					}
				}
			} catch (error) {
				reply.error =
					error instanceof Error
						? error.message
						: "検査に失敗しました。";
			}
			post(state);
			post(reply);
		},
	};
}

/** 実コンポーネントを同じ Bridge 契約で描画する。 */
function EditorStory() {
	const bridge = useMemo(mockBridge, []);
	return (
		<div
			style={{ display: "contents" }}
			data-story-guardrails
			ref={(element) => {
				if (element) {
					Object.assign(element, { response: bridge.response });
				}
			}}
		>
			<GuardrailsEditor bridge={bridge} />
		</div>
	);
}

const meta = {
	title: "Pi/Guardrails",
	component: EditorStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof EditorStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Editor: Story = {};

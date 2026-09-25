// 専用エディターの編集・保存・検査を、ファイルを書き換えない通信モックで再現する。
import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { GuardrailsEditor } from "../../../webview/pi/guardrails/GuardrailsEditor";
import {
	defaultGuardrails,
	parseGuardrails,
} from "../../../shared/guardrails/config";
import type {
	GuardBridge,
	GuardReply,
	GuardState,
} from "../../../shared/guardrails/messages";

/** 文書通知を先に送り、Host と同じ順序で処理完了を通知する。 */
function mockBridge(): GuardBridge {
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
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		postMessage(message) {
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
				if (message.version !== state.version) {
					throw new Error("文書が変更されています。");
				}
				if (message.type === "edit") {
					state = {
						...state,
						text: message.text,
						version: state.version + 1,
						dirty: true,
					};
				} else {
					parseGuardrails(state.text);
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
	return <GuardrailsEditor bridge={bridge} />;
}

const meta = {
	title: "Pi/Guardrails",
	component: EditorStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof EditorStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Editor: Story = {};

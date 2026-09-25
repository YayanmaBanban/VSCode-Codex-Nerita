// Plan 完了カードの表示と選択操作を確認するストーリー。
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { initialState, type ChatState } from "../../shared/chatState";
import { PlanDecisionCard } from "../../webview/chat/PlanDecisionCard";

/** 選択後にカードが閉じる状態を再現する。 */
function PlanDecisionStory() {
	const [state, setState] = useState<ChatState>(() => ({
		...initialState(),
		connection: "ready" as const,
		sessionId: "story-session",
		run: "completed" as const,
		planDecision: { runId: "story-run", text: "実装計画" },
	}));
	return (
		<div className="mx-auto max-w-[700px] p-5">
			<PlanDecisionCard
				state={state}
				send={(message) => {
					if (message.type === "plan/decide") {
						setState((current) => ({
							...current,
							planDecision: null,
						}));
					}
				}}
			/>
		</div>
	);
}

const meta = {
	title: "Chat/Plan Decision",
	component: PlanDecisionStory,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PlanDecisionStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Completed: Story = {};

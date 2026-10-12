<!-- 選択要求への応答だけを注入し、Plan 完了カードの表示を観察する。 -->
<script lang="ts">
	import { initialState, type ChatState } from "@nerita/shared/chatState";
	import type { UiMessage } from "@nerita/shared/messages";
	import PlanDecisionCard from "../../src/chat/PlanDecisionCard.svelte";
	import "../../src/chat/chat.css";
	let chatState = $state.raw<ChatState>({
		...initialState(),
		connection: "ready",
		sessionId: "story-session",
		run: "completed",
		planDecision: { runId: "story-run", text: "実装計画" },
	});
	/** 選択後の Host 通知によるカードの消去を模擬する。 */
	function send(message: UiMessage) {
		if (message.type === "plan/decide") {
			chatState = { ...chatState, planDecision: null };
		}
	}
</script>

<div class="mx-auto max-w-[700px] p-5">
	<PlanDecisionCard state={chatState} {send} />
</div>

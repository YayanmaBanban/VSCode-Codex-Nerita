// ヘッダーへ渡す UI 状態と操作の契約を、描画コンポーネントから分離する。
import type { useChat } from "./useChat.svelte";
import type { useChatView } from "./useChatView.svelte";
import type { useSessionPanel } from "./sessions/useSessionPanel.svelte";

/** ヘッダーで会話と表示先を操作するための状態。 */
export type ChatWorkspaceHeader = {
	view: ReturnType<typeof useChatView>;
	chat: ReturnType<typeof useChat>;
	sessionPanel: ReturnType<typeof useSessionPanel>;
	available: boolean;
};

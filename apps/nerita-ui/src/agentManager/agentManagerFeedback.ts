// 管理画面の各フォームへ、Host のエラーと再読み込み操作を同じ画面内の context で渡す。
import { createContext } from "svelte";

/** 値は getter で提供し、保存応答や再読み込み中の状態を利用側へ反映する。 */
export type AgentManagerFeedback = {
	readonly errors: readonly string[];
	readonly busy: boolean;
	readonly reloadRequired: boolean;
	reload: () => void;
};

/** 管理画面または単独プレビューが提供し、その配下のフッターから参照する。 */
export const [getManagerFeedback, provideManagerFeedback] =
	createContext<AgentManagerFeedback>();

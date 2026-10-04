// バックエンド別画面へ渡す表示状態と編集操作の契約。
import type { ManagerState } from "@nerita/shared/agentManager/messages";
import type { ManagerSave } from "./useAgentManager";

/** 選択・未保存状態は共通画面が管理し、保存内容は各バックエンドで組み立てる。 */
export type AgentManagerProps = {
	state: ManagerState;
	busy: boolean;
	save: ManagerSave;
	selected: string;
	onSelect: (id: string) => void;
	onDirty: () => void;
};

// Pi の既定設定の編集欄と保存操作へ渡す入力型を定義する。

import { type PiDefaults } from "@nerita/shared/agentManager/config";

import { type ManagerModel } from "@nerita/shared/agentManager/messages";

import { type ManagerSave } from "../agentManager/useAgentManager.svelte";

/** Pi の既定設定とモデル候補を渡し、保存は管理画面の要求経路を使う。 */
export type PiDefaultsSettingsProps = {
	defaults: PiDefaults;
	models: ManagerModel[];
	busy: boolean;
	save: ManagerSave;
};
/** Pi の既定設定の下書きと、モデル・推論の検証エラーを入力欄へ渡す。 */
export type PiDefaultsFieldsProps = {
	busy: boolean;
	edit: PiDefaults;
	models: ManagerModel[];
	setEdit: (value: PiDefaults) => void;
	error: undefined | string;
};

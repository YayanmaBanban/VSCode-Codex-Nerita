// 表示用の型と文書変換を共有し、各入力欄では状態を複製しない。

import { type PiDefaults } from "@nerita/shared/agentManager/config";

import { type ManagerModel } from "@nerita/shared/agentManager/messages";

import { type ManagerSave } from "../agentManager/useAgentManager.svelte";

/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type PiDefaultsSettingsProps = {
	defaults: PiDefaults;
	models: ManagerModel[];
	busy: boolean;
	save: ManagerSave;
};
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type PiDefaultsFieldsProps = {
	busy: boolean;
	edit: PiDefaults;
	models: ManagerModel[];
	setEdit: (value: PiDefaults) => void;
	error: undefined | string;
};

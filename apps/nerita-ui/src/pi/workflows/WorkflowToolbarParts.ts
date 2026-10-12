// 表示用の型と文書変換を共有し、各入力欄では状態を複製しない。

import { type useWorkflow } from "./useWorkflow.svelte";
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
export type WorkflowEditorState = ReturnType<typeof useWorkflow>;

// 文書編集の状態と操作を、ワークフローのツールバーへ渡す。

import { type useWorkflow } from "./useWorkflow.svelte";
/** ツールバーから文書の保存・検証・実行を要求するための編集状態。 */
export type WorkflowEditorState = ReturnType<typeof useWorkflow>;

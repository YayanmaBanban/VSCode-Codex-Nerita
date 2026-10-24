// 表示中の編集フォームから下書きを取得し、再生成時には選択された下書きを渡す。
import { getContext, setContext, onMount } from "svelte";
import type { ManagerDraft } from "@nerita/shared/agentManager/draft";

/** 現在表示中のフォームが提供する退避・保存操作。 */
export type DraftEditor = {
	capture: () => ManagerDraft;
	submit: () => void;
	canSave: () => boolean;
};
/** 復元する下書きと、表示中のフォームの登録先。 */
type DraftContext = {
	register: (editor: DraftEditor) => () => void;
	readonly restored: ManagerDraft | null;
};
const key = Symbol("manager-draft");
/** フォームのライフサイクルと同じ期間だけ、取得・保存操作を公開する。 */
export function registerDraftEditor(editor: DraftEditor) {
	const context = getContext<DraftContext | undefined>(key);
	onMount(() => context?.register(editor));
	return context;
}
/** 管理画面内で下書きとフォームの操作を共有する。 */
export function provideDraftContext(context: DraftContext) {
	setContext(key, context);
}

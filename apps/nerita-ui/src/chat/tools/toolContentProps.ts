// ツール本文の表示方法を切り替えるコンポーネントで、入力契約を共用する。
import type { ToolSummary } from "@nerita/shared/chatState";
import type { UiMessage } from "@nerita/shared/messages";

/** 編集差分と保存要約を同じ本文表示へ渡すための入力。 */
export type ToolContentProps = {
	tool: ToolSummary;
	send?: ((message: UiMessage) => void) | undefined;
	cwd?: string | null | undefined;
};

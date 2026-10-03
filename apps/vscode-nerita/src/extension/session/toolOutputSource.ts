// バックエンドから状態同期へ出力の更新方法を渡す。内部参照は DTO に含めない。
import type { ToolSummary } from "@nerita/shared/chatState";

/** delta は Codex の追記、text は Pi の累積結果や保存イベントの確定本文。 */
export type ToolOutputSource = {
	text: string;
	delta?: boolean;
	truncated?: boolean;
	path?: string;
};

const sources = new WeakMap<ToolSummary, ToolOutputSource>();

/** アダプターが検証した出力元を、シリアライズされない領域へ登録する。 */
export function setToolOutputSource(
	tool: ToolSummary,
	source: ToolOutputSource,
) {
	sources.set(tool, source);
}

/** 同じツールの再配信では追記を繰り返さないよう、一度だけ取り出す。 */
export function takeToolOutputSource(tool: ToolSummary) {
	const source = sources.get(tool);
	sources.delete(tool);
	return source;
}

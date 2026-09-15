// 実行カードに関連付けられた端末だけを停止対象として取り出す。
import type { ToolSummary } from "./messages";
import { isRecord } from "./validation";

/** Hostが管理する端末の表示用スナップショット。 */
export type TerminalSnapshot = {
	cwd: string;
	output: string;
	truncated: boolean;
	canStop: boolean;
	exitStatus?: { exitCode?: number | null; signal?: string | null };
};

/** ツール ID を端末 ID と推測せず、ACP の端末参照を使用する。 */
export function toolTerminalId(tool: ToolSummary): string | undefined {
	const terminal = tool.content?.find(
		(value) =>
			isRecord(value) &&
			value.type === "terminal" &&
			typeof value.terminalId === "string" &&
			value.terminalId.length > 0,
	);
	return isRecord(terminal) ? (terminal.terminalId as string) : undefined;
}

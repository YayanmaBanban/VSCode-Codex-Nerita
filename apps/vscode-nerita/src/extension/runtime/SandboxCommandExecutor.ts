// Shell ツールが依存する最小契約。実装の差し替えは Host の組み立て時だけ行う。
import type {
	ApprovedToolCall,
	SandboxExecutionInfo,
} from "../security/ApprovedToolCall";
import type { AgentAccessPolicy } from "../security/AgentAccessPolicy";

/** 実行基盤が返す標準出力・標準エラー・終了コードを保持する。 */
export type SandboxCommandResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};
/** 全出力は結果で保持し、途中経過は呼出し側が必要な場合だけ受け取る。 */
export type SandboxCommandOutput = (
	stream: "stdout" | "stderr",
	text: string,
) => void;
/** 未承認の文字列を受け付けない実行境界。 */
export type SandboxCommandExecutor = {
	describe?(policy: AgentAccessPolicy): SandboxExecutionInfo;
	execute(
		approved: ApprovedToolCall,
		onOutput?: SandboxCommandOutput,
	): Promise<SandboxCommandResult>;
};

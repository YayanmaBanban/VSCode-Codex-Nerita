// Shell Toolが依存する最小契約。実装の差し替えはHostの組み立て時だけ行う。
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
/** 未承認の文字列を受け付けない実行境界。 */
export type SandboxCommandExecutor = {
	describe?(policy: AgentAccessPolicy): SandboxExecutionInfo;
	execute(approved: ApprovedToolCall): Promise<SandboxCommandResult>;
};

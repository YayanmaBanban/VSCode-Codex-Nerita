// PiにCodexClientを公開せず、承認済みのcommandだけを実行する契約。
import type { ApprovedToolCall } from "../security/ApprovedToolCall";

/** stdout / stderr / exit codeを失わずbackendへ返す。 */
export type SandboxCommandResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};
/** Sandboxが利用できない場合はrejectし、Host実行へfallbackしない。 */
export type SandboxCommandExecutor = {
	execute(call: ApprovedToolCall): Promise<SandboxCommandResult>;
};

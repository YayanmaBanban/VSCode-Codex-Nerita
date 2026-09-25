// 独立したコマンドと Windows Sandbox 状態の応答を検証する。
import { z } from "zod";

const resultSchema = z.object({
	exitCode: z.number().int(),
	stdout: z.string(),
	stderr: z.string(),
});
const readinessSchema = z.object({
	status: z.enum(["ready", "notConfigured", "updateRequired"]),
});
/** 生の応答を検証してから `Executor` へ渡す。 */
export const parseCommandResult = (value: unknown) => resultSchema.parse(value);
/** 未知の `readiness` は `ready` として扱わない。 */
export const parseSandboxReadiness = (value: unknown) =>
	readinessSchema.parse(value);
/** セットアップ受付と完了を混同せず、受付フラグだけを読む。 */
export const parseSandboxSetup = (value: unknown) =>
	z.object({ started: z.boolean() }).parse(value);

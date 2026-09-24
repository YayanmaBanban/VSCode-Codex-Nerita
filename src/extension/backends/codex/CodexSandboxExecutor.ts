// commandごとの専用接続でSandboxを実行し、停止時は子プロセスごと回収する。
import type { WindowsSandboxImplementation } from "../../../shared/windowsSandbox";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
	containsPath,
	policyWorkspaceRoots,
	shellAccessDeniedReason,
} from "../../security/AgentAccessPolicy";
import {
	consumeApprovedToolCall,
	type ApprovedToolCall,
	type ToolCall,
} from "../../security/ApprovedToolCall";
import type { SandboxCommandExecutor } from "../../runtime/SandboxCommandExecutor";
import { CodexClient } from "./CodexClient";
import { verifySandboxNetwork } from "./SandboxNetworkProbe";

/** 実接続とテスト接続で同じcleanup契約を使う。 */
export type SandboxConnection = Pick<
	CodexClient,
	"executeCommand" | "terminateCommand" | "readSandboxReadiness" | "dispose"
>;
export type SandboxConnector = (
	cwd: string,
	signal: AbortSignal,
) => Promise<SandboxConnection>;

/** provider認証やthreadを必要としない共通実行service。 */
export class CodexSandboxExecutor implements SandboxCommandExecutor {
	constructor(
		private readonly connect: SandboxConnector,
		private readonly platform = process.platform,
		private readonly verifyNetwork = verifySandboxNetwork,
	) {}

	/** 承認・snapshot検証後だけ接続し、あらゆる終了経路で専用接続を閉じる。 */
	async execute(approved: ApprovedToolCall) {
		const call = consumeApprovedToolCall(approved);
		await validateSandboxCall(call);
		const roots = call.policy.filesystem.writableRoots;
		approved.signal.throwIfAborted();
		const client = await this.connect(call.cwd, approved.signal);
		const processId = randomUUID();
		// abortとfinallyが競合しても、同じ回収の完了を待ってからToolを終了する。
		let closing: Promise<void> | undefined;
		const close = () =>
			(closing ??= Promise.resolve().then(() => client.dispose()));
		const abort = () => {
			void close().catch(() => undefined);
		};
		approved.signal.addEventListener("abort", abort, { once: true });
		try {
			approved.signal.throwIfAborted();
			if (this.platform !== "win32") {
				throw new Error("このExecutorはWindows Sandbox専用です。");
			}
			if ((await client.readSandboxReadiness()).status !== "ready") {
				throw new Error(
					"CodexのWindows Sandboxをセットアップしてから再実行してください。Host実行へは切り替えません。",
				);
			}
			approved.signal.throwIfAborted();
			if (!call.policy.network.enabled) {
				await this.verifyNetwork(client, call);
			}
			approved.signal.throwIfAborted();
			const result = await client.executeCommand({
				command: [...call.command!],
				cwd: call.cwd,
				env: { ...call.env },
				processId,
				timeoutMs: call.timeoutMs!,
				sandboxPolicy: roots.length
					? {
							type: "workspaceWrite",
							writableRoots: [...roots],
							networkAccess: call.policy.network.enabled,
							excludeTmpdirEnvVar: true,
							excludeSlashTmp: true,
						}
					: {
							type: "readOnly",
							networkAccess: call.policy.network.enabled,
						},
			});
			approved.signal.throwIfAborted();
			return result;
		} finally {
			approved.signal.removeEventListener("abort", abort);
			await close();
		}
	}
}

/** 承認中にrootやcwdのjunctionが差し替わった場合は再承認を求める。 */
async function validateSandboxCall(call: ToolCall) {
	validateCommand(call);
	const denied = shellAccessDeniedReason(call.policy);
	if (denied) {
		throw new Error(denied);
	}
	const roots = call.policy.filesystem.writableRoots;
	for (const path of [...roots, call.cwd]) {
		if ((await realpath(path)) !== path) {
			throw new Error("パスが変更されました。再承認が必要です。");
		}
	}
	if (
		!policyWorkspaceRoots(call.policy).some((root) =>
			containsPath(root, call.cwd),
		)
	) {
		throw new Error("cwdがworkspace外です。");
	}
	if (roots.length && !roots.some((root) => containsPath(root, call.cwd))) {
		throw new Error("cwdが書込み許可範囲外です。");
	}
}

/** 未対応のmode・無制限timeoutをRPCへ渡さない。 */
function validateCommand(call: ToolCall) {
	if (
		call.policy.command.mode !== "sandboxed" ||
		!call.command?.length ||
		!Number.isSafeInteger(call.timeoutMs) ||
		!call.timeoutMs ||
		call.timeoutMs < 1 ||
		call.timeoutMs > 600_000
	) {
		throw new Error("未対応のSandbox要求です。");
	}
}

/** Piの会話接続とは別に、実行中だけApp Serverを保持する。 */
export function createCodexSandboxExecutor(
	extensionPath: string,
	windowsSandbox: WindowsSandboxImplementation = "elevated",
): SandboxCommandExecutor {
	return new CodexSandboxExecutor((cwd, signal) =>
		CodexClient.connect({
			extensionPath,
			cwd,
			signal,
			forceWindowsSandbox: true,
			windowsSandbox,
			clientInfo: {
				name: "nerita_sandbox",
				title: "Nerita Sandbox",
				version: "0.0.1",
			},
		}),
	);
}

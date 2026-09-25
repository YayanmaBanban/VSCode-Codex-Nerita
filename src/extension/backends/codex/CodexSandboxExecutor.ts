// 実行ごとの専用 App Server で `command/exec` を呼び、停止と終了時の回収を一度だけ待つ。
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
	containsPath,
	toSandboxPolicy,
	type AgentAccessPolicy,
	type WindowsSandboxImplementation,
} from "../../security/AgentAccessPolicy";
import {
	consumeApprovedToolCall,
	type ApprovedToolCall,
	type ToolCall,
} from "../../security/ApprovedToolCall";
import type { SandboxCommandExecutor } from "../../runtime/SandboxCommandExecutor";
import { CodexClient } from "./CodexClient";

/** provider・スレッドを必要としない専用接続の契約。 */
export type SandboxConnection = Pick<
	CodexClient,
	| "executeCommand"
	| "terminateCommand"
	| "readSandboxReadiness"
	| "readSandboxConfig"
	| "dispose"
>;
export type SandboxConnector = (
	cwd: string,
	signal: AbortSignal,
	mode: WindowsSandboxImplementation,
) => Promise<SandboxConnection>;

/** 常時失敗検査や Host シェルへのフォールバックを挟まず、確定した `policy` を実行する。 */
export class CodexSandboxExecutor implements SandboxCommandExecutor {
	constructor(
		private readonly connect: SandboxConnector,
		private readonly platform = process.platform,
	) {}
	/** この実装固有の表示は、共通のツール説明や承認処理へ埋め込まない。 */
	describe(policy: AgentAccessPolicy) {
		return {
			name: "Codex",
			details: [
				`Windows Sandbox: ${policy.windowsSandbox}${policy.windowsSandbox === "unelevated" ? "（通信隔離が弱い実装）" : ""}`,
				"Shell read: workspace外もOS権限に従う / temp書込み例外: 無効",
			],
		};
	}
	async execute(approved: ApprovedToolCall) {
		const call = consumeApprovedToolCall(approved);
		await validateSandboxCall(call);
		approved.signal.throwIfAborted();
		if (this.platform !== "win32") {
			throw new Error(
				`現在のShell実行基盤は${this.platform}に対応していません。`,
			);
		}
		const client = await this.connect(
			call.cwd,
			approved.signal,
			call.policy.windowsSandbox,
		);
		const processId = randomUUID();
		let started = false;
		let closing: Promise<void> | undefined;
		// `abort` と `finally` の両方が同じ回収の完了を待つ。
		const close = () =>
			(closing ??= Promise.resolve().then(async () => {
				try {
					if (started) {
						await client.terminateCommand(processId);
					}
				} catch {
					/* 終了済み・通信断でも所有する専用プロセスを必ず回収する。 */
				} finally {
					await client.dispose();
				}
			}));
		const abort = () => {
			void close().catch(() => undefined);
		};
		approved.signal.addEventListener("abort", abort, { once: true });
		try {
			approved.signal.throwIfAborted();
			const config = await client.readSandboxConfig(call.cwd);
			if (config.sandbox !== call.policy.windowsSandbox) {
				throw new Error(
					"承認したWindows Sandbox実装と実効設定が一致しません。",
				);
			}
			const readiness = await client.readSandboxReadiness();
			if (readiness.status !== "ready") {
				throw new Error(
					`Windows Sandbox: ${readiness.status}。コマンド「Nerita: Pi用のCodex Windows Sandboxをセットアップ」を実行してください。`,
				);
			}
			await validateSandboxCall(call);
			approved.signal.throwIfAborted();
			started = true;
			const result = await client.executeCommand({
				command: [...call.command!],
				cwd: call.cwd,
				env: { ...call.env },
				processId,
				timeoutMs: call.timeoutMs!,
				sandboxPolicy: toSandboxPolicy(call.policy),
			});
			approved.signal.throwIfAborted();
			return result;
		} finally {
			approved.signal.removeEventListener("abort", abort);
			await close();
		}
	}
}

/** 承認後の `root/cwd` 差し替えと、`cwd` の暗黙 `write` 追加を拒否する。 */
function validateCommand(call: ToolCall) {
	if (
		!call.policy.shell ||
		!call.command?.length ||
		!call.command.every(
			(part) => typeof part === "string" && !part.includes("\0"),
		) ||
		!Number.isSafeInteger(call.timeoutMs) ||
		!call.timeoutMs ||
		call.timeoutMs < 1 ||
		call.timeoutMs > 600_000
	) {
		throw new Error("未対応のSandbox要求です。");
	}
}

/** 実在する `cwd` と `roots` を、実行直前にも確認する。 */
async function validateSandboxCall(call: ToolCall) {
	validateCommand(call);
	if (
		call.policy.writableRoots.some(
			(root) =>
				!call.policy.workspaceRoots.some((workspace) =>
					containsPath(workspace, root),
				),
		)
	) {
		throw new Error("書込み許可範囲外のrootです。");
	}
	for (const path of [
		...call.policy.workspaceRoots,
		...call.policy.writableRoots,
		call.cwd,
	]) {
		if ((await realpath(path)) !== path) {
			throw new Error("パスが変更されました。再承認が必要です。");
		}
	}
	if (
		!call.policy.workspaceRoots.some((root) => containsPath(root, call.cwd))
	) {
		throw new Error("cwdがworkspace境界外です。");
	}
	if (
		call.policy.writableRoots.length &&
		!call.policy.writableRoots.some((root) => containsPath(root, call.cwd))
	) {
		throw new Error(
			"cwdが書込み許可範囲外です。readOnlyまたは許可root内のcwdを指定してください。",
		);
	}
}

/** 既存 Codex バックエンドの実効設定を読み、未指定のときだけ `elevated` を基準にする。 */
export async function resolveWindowsSandbox(
	extensionPath: string,
	cwd: string,
	signal: AbortSignal,
): Promise<WindowsSandboxImplementation> {
	const client = await CodexClient.connect({
		extensionPath,
		cwd,
		signal,
		clientInfo: {
			name: "nerita_sandbox_config",
			title: "Nerita Sandbox",
			version: "0.0.1",
		},
	});
	try {
		const { sandbox } = await client.readSandboxConfig(cwd);
		if (sandbox === null) {
			return "elevated";
		}
		if (sandbox === "elevated" || sandbox === "unelevated") {
			return sandbox;
		}
		throw new Error(`Windows Sandboxの設定に対応していません: ${sandbox}`);
	} finally {
		await client.dispose();
	}
}

/** 接続自体の `signal` は `Executor` が回収し、`abort` で `terminate` 前に接続を失わないようにする。 */
export function createCodexSandboxExecutor(
	extensionPath: string,
): SandboxCommandExecutor {
	return new CodexSandboxExecutor((cwd, signal, windowsSandbox) =>
		CodexClient.connect({
			extensionPath,
			cwd,
			signal,
			windowsSandbox,
			connectAbortOnly: true,
			clientInfo: {
				name: "nerita_sandbox",
				title: "Nerita Sandbox",
				version: "0.0.1",
			},
		}),
	);
}

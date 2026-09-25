// OS ごとに実行基盤を選び、Windows のシェルだけをサンドボックスへ接続する。
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { realpath } from "node:fs/promises";
import {
	createWorkspaceAccessPolicy,
	WorkspacePathPolicy,
} from "../../security/WorkspacePathPolicy";
import {
	intersectPolicy,
	containsPath,
	type WindowsSandboxImplementation,
} from "../../security/AgentAccessPolicy";
import {
	createCodexSandboxExecutor,
	resolveWindowsSandbox,
} from "../codex/CodexSandboxExecutor";
import { createPiShellTools } from "./PiShellTools";
import { createPiFileTool } from "./PiFileTools";
import { createPiHostShellTool } from "./PiHostShellTool";
import type { PiRuntimeOptions } from "./PiRuntime";
import type { PiAuthorize } from "./PiApprovedTools";
import { createPiReadTool } from "./guardrails/PiReadTools";

/** SDK のシェル設定だけを実行ツールへ引き継ぐ。 */
type ShellSettings = Pick<
	PiSdk.SettingsManager,
	"getShellPath" | "getShellCommandPrefix"
>;

/** role の書込み先を実体パスに変換し、親の許可範囲と共通する権限だけでツールを作る。 */
export async function preparePiRuntimeTools(
	sdk: typeof PiSdk,
	options: PiRuntimeOptions,
	authorize: PiAuthorize,
	settings?: ShellSettings,
) {
	const windows = process.platform === "win32";
	const { mode, unavailable } = windows
		? await executionMode(options)
		: { mode: undefined, unavailable: undefined };
	options.signal.throwIfAborted();
	const paths = await runtimePaths(options, mode);
	const { cwd, policy } = paths;
	const tools = ["write", "edit"].map((kind) =>
		createPiFileTool(
			sdk,
			kind as "write" | "edit",
			paths,
			authorize,
			options.signal,
		),
	);
	tools.push(
		...(["read", "ls"] as const).map((kind) =>
			createPiReadTool(sdk, kind, paths, authorize, options.signal),
		),
	);
	// OS による選択であり、Windows のサンドボックス失敗を Host 実行へ切り替える処理ではない。
	if (!windows) {
		tools.push(
			createPiHostShellTool(
				sdk.createBashToolDefinition(cwd, hostShellOptions(settings)),
				cwd,
				authorize,
				policy,
				options.signal,
			),
		);
		return { paths, tools, executor: null, unavailable: undefined };
	}
	const executor =
		options.executor === undefined
			? createCodexSandboxExecutor(options.extensionPath)
			: options.executor;
	const reason = !policy.shell
		? "このroleではShell実行が禁止されています。"
		: (unavailable ??
			(!executor ? "Sandbox Executorが接続されていません。" : undefined));
	tools.push(
		...(await createPiShellTools(
			sdk,
			paths,
			authorize,
			executor,
			options.signal,
			reason,
		)),
	);
	return { paths, tools, executor, unavailable: reason };
}

/** 未指定の設定は SDK の既定値を使う。 */
function hostShellOptions(settings?: ShellSettings): PiSdk.BashToolOptions {
	const shellPath = settings?.getShellPath();
	const commandPrefix = settings?.getShellCommandPrefix();
	return {
		...(shellPath ? { shellPath } : {}),
		...(commandPrefix ? { commandPrefix } : {}),
	};
}

/** ファイル操作と子 `role` の範囲は OS に依存せず確認する。 */
async function runtimePaths(
	options: PiRuntimeOptions,
	mode?: WindowsSandboxImplementation,
) {
	const base =
		options.parentPolicy ??
		(await createWorkspaceAccessPolicy(
			options.workspaceRoots ?? [options.cwd],
			mode ?? "elevated",
		));
	const role = { ...options.role };
	if (role.writableRoots) {
		role.writableRoots = await Promise.all(
			role.writableRoots.map((root) => realpath(root)),
		);
	}
	const cwd = await realpath(options.cwd);
	const guardrailsRoot =
		base.guardrailsRoot ??
		base.workspaceRoots
			.filter((root) => containsPath(root, cwd))
			.sort((a, b) => b.length - a.length)[0] ??
		cwd;
	const paths = new WorkspacePathPolicy(
		intersectPolicy({ ...base, guardrailsRoot }, role),
		cwd,
	);
	await paths.resolveWorkspace(cwd);
	return paths;
}

/** 設定取得の失敗をシェル固有の利用不能理由にし、`read` やモデル接続は維持する。 */
async function executionMode(options: PiRuntimeOptions) {
	const mode = options.parentPolicy?.windowsSandbox ?? options.windowsSandbox;
	if (options.sandboxUnavailable) {
		return { mode, unavailable: options.sandboxUnavailable };
	}
	if (mode) {
		return { mode, unavailable: undefined };
	}
	try {
		return {
			mode: await resolveWindowsSandbox(
				options.extensionPath,
				options.cwd,
				options.signal,
			),
			unavailable: undefined,
		};
	} catch (error) {
		return {
			mode: undefined,
			unavailable: `Shell実行基盤の設定を取得できません: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

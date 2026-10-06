// OS ごとに実行基盤を選び、Windows のシェルだけをサンドボックスへ接続する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { realpath } from "node:fs/promises";
import {
	createWorkspaceAccessPolicy,
	WorkspacePathPolicy,
} from "../../security/WorkspacePathPolicy";
import {
	intersectPolicy,
	containsPath,
} from "../../security/AgentAccessPolicy";
import { createSandboxExecutor } from "../../runtime/CreateSandboxExecutor";
import { createPiShellTools } from "./PiShellTools";
import { createPiFileTool } from "./PiFileTools";
import { createPiHostShellTool } from "./PiHostShellTool";
import type { PiRuntimeOptions } from "./PiRuntime";
import type { PiAuthorize } from "./PiApprovedTools";
import { createPiReadTool } from "./guardrails/PiReadTools";
import { piWorkspaceTrusted } from "./PiTrustAdapter";
import { createPiSearchTools } from "./guardrails/PiSearchTools";
import { createPiPnpmTool } from "./PiPnpmTool";
import { CredentialExecutor } from "../../credentials/CredentialExecutor";
import type { SandboxCommandExecutor } from "../../runtime/SandboxCommandExecutor";

/** SDK のシェル設定だけを実行ツールへ引き継ぐ。 */
type ShellSettings = Pick<
	PiSdk.SettingsManager,
	"getShellPath" | "getShellCommandPrefix"
>;

/** `role` の書込み先を実体パスに変換し、親の許可範囲と共通する権限だけでツールを作る。 */
export async function preparePiRuntimeTools(
	sdk: typeof PiSdk,
	options: PiRuntimeOptions,
	authorize: PiAuthorize,
	settings?: ShellSettings,
) {
	const windows = process.platform === "win32";
	const trusted = await piWorkspaceTrusted(options);
	const { executor, unavailable } =
		windows && trusted
			? await executionMode(options)
			: {
					executor: null,
					unavailable: trusted
						? undefined
						: "未信頼のWorkspaceではShellを実行できません。",
				};
	options.signal.throwIfAborted();
	const paths = await runtimePaths(options);
	const { cwd, policy } = paths;
	const tools = (["write", "edit"] as const).map((kind) =>
		createPiFileTool(sdk, kind, paths, authorize, options.signal),
	);
	tools.push(
		...(["read", "ls"] as const).map((kind) =>
			createPiReadTool(sdk, kind, paths, authorize, options.signal),
		),
	);
	tools.push(...createPiSearchTools(sdk, paths, authorize, options.signal));
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
	const reason = !policy.shell
		? "このroleではShell実行が禁止されています。"
		: (unavailable ??
			(!executor ? "Sandbox Executorが接続されていません。" : undefined));
	if (executor && !isNonEmptyString(reason)) {
		tools.push(
			createPiPnpmTool(
				paths,
				authorize,
				executor,
				options.signal,
				options.credentialBroker,
			),
		);
	}
	tools.push(
		...(await createPiShellTools(
			sdk,
			paths,
			authorize,
			withCredentials(executor, options, authorize),
			options.signal,
			reason,
			trustDeniedReporter(options, trusted),
		)),
	);
	return { paths, tools, executor, unavailable: reason };
}

/** 子 Runtime には元の Executor を渡し、その Runtime の承認関数で包み直す。 */
function withCredentials(
	executor: SandboxCommandExecutor | null,
	options: PiRuntimeOptions,
	authorize: PiAuthorize,
) {
	return executor && options.credentialBroker
		? new CredentialExecutor(executor, options.credentialBroker, authorize)
		: executor;
}

/** 起動準備を省いた未信頼の Shell の拒否も監査へ残す。 */
function trustDeniedReporter(
	options: PiRuntimeOptions,
	trusted: boolean,
): (() => void) | undefined {
	return trusted
		? undefined
		: () => options.trustStore?.audit("execution-denied", options.cwd);
}

/** 未指定の設定は SDK の既定値を使う。 */
function hostShellOptions(settings?: ShellSettings): PiSdk.BashToolOptions {
	const shellPath = settings?.getShellPath();
	const commandPrefix = settings?.getShellCommandPrefix();
	return {
		...(isNonEmptyString(shellPath) ? { shellPath } : {}),
		...(isNonEmptyString(commandPrefix) ? { commandPrefix } : {}),
	};
}

/** ファイル操作と子の `role` の範囲は OS に依存せず確認する。 */
async function runtimePaths(options: PiRuntimeOptions) {
	const base =
		options.parentPolicy ??
		(await createWorkspaceAccessPolicy(
			options.workspaceRoots ?? [options.cwd],
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
		intersectPolicy(
			{
				...base,
				readableRoots: base.readableRoots ?? base.workspaceRoots,
				guardrailsRoot,
				trustContextId: options.trustContextId ?? base.trustContextId,
			},
			role,
		),
		cwd,
	);
	await paths.resolveWorkspace(cwd);
	return paths;
}

/** 設定取得の失敗をシェル固有の利用不能理由にし、`read` やモデル接続は維持する。 */
async function executionMode(options: PiRuntimeOptions) {
	if (isNonEmptyString(options.sandboxUnavailable)) {
		return { executor: null, unavailable: options.sandboxUnavailable };
	}
	if (options.executor !== undefined) {
		return { executor: options.executor, unavailable: undefined };
	}
	const result = await createSandboxExecutor(
		"mxc",
		options.extensionPath,
		options.cwd,
		options.signal,
		undefined,
		undefined,
		options.sandboxManagement,
	);
	options.sandboxManagement?.availability(result.availability);
	return {
		executor: result.executor,
		unavailable: result.availability.reason,
	};
}

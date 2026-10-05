// 承認済み要求を MXC ポリシーへ変換し、Host 環境の秘密や暗黙の書込み許可を持ち込まない。
import type { ContainerConfig } from "@microsoft/mxc-sdk";
import type { ToolCall } from "../security/ApprovedToolCall";
import type { MxcSdk } from "./MxcSdk";
import type { DevToolPolicy, SandboxPolicy } from "./DevToolPolicy";
import { devToolEnvironment } from "./DevToolDiscovery";

/** CreateProcess の argv 規則に従う。シェルのメタ文字として再解釈しない。 */
function quoteWindowsArgument(value: string): string {
	return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

/** tools の補助書込み許可は採用しない。temp は呼出しごとの専用領域だけを許可する。 */
export function createMxcConfig(
	sdk: MxcSdk,
	call: ToolCall,
	temporary: string,
	devTools?: DevToolPolicy,
): ContainerConfig {
	const policy = resolveSandboxPolicy(call, devTools);
	const env = policy.devTools.environment;
	const readonly = policy.devTools.resources
		.filter(
			(resource) =>
				resource.access === "read" &&
				["install", "helper", "config"].includes(resource.kind),
		)
		.map((resource) => resource.target);
	const caches = policy.devTools.resources
		.filter(
			(resource) =>
				resource.kind === "cache" && resource.access === "readwrite",
		)
		.map((resource) => resource.target);
	const config = sdk.createConfigFromPolicy(
		{
			version: "0.9.0-alpha",
			filesystem: {
				readonlyPaths: [
					...new Set([
						...readonly,
						...policy.workspace.readonlyRoots,
					]),
				].filter(
					(root) => !policy.workspace.writableRoots.includes(root),
				),
				readwritePaths: [
					...policy.workspace.writableRoots,
					temporary,
					...caches,
				],
			},
			network: {
				egress: {
					default: policy.network.internet,
				},
				ingress: {
					default: "deny",
					hostLoopback: policy.network.localhost,
				},
			},
			ui: {
				allowWindows: policy.ui.allowWindows,
				clipboard: "none",
				allowInputInjection: false,
			},
			timeoutMs: call.timeoutMs!,
		},
		"process",
	);
	// SDK 0.9.0 の変換関数は "process" を要求するため、生成後に実行バックエンドを固定する。
	config.containment = "processcontainer";
	config.process = {
		...config.process,
		commandLine: call.command!.map(quoteWindowsArgument).join(" "),
		cwd: call.cwd,
		env: Object.entries({ ...env, TEMP: temporary, TMP: temporary }).map(
			([key, value]) => `${key}=${value}`,
		),
	};
	return config;
}

/** 承認済みのワークスペース・通信権限と Host が検出したツール権限を合成する。 */
function resolveSandboxPolicy(
	call: ToolCall,
	devTools?: DevToolPolicy,
): SandboxPolicy {
	return {
		workspace: {
			readonlyRoots: call.policy.workspaceRoots,
			writableRoots: call.policy.writableRoots,
		},
		network: {
			internet: call.policy.networkAccess ? "allow" : "deny",
			localhost: "deny",
		},
		ui: { allowWindows: true, clipboard: "deny", inputInjection: "deny" },
		devTools: devTools ?? {
			resources: [],
			environment: devToolEnvironment(call.env ?? {}),
			executables: {},
		},
	};
}

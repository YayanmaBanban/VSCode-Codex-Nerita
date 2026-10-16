// 承認済み要求を MXC ポリシーへ変換し、Host 環境の秘密や暗黙の書込み許可を持ち込まない。
import type { ContainerRequest, Containment } from "@microsoft/mxc-sdk/v1";
import { win32 } from "node:path";
import type { ToolCall } from "../security/ApprovedToolCall";
import type { DevToolPolicy, SandboxPolicy } from "./DevToolPolicy";
import { devToolEnvironment } from "./DevToolDiscovery";

/** CreateProcess の argv 規則に従う。シェルのメタ文字として再解釈しない。 */
function quoteWindowsArgument(value: string): string {
	return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

/** ツールの補助書込み許可は採用しない。一時領域は呼出しごとの専用領域だけを許可する。 */
export function createMxcRequest(
	call: ToolCall,
	temporary: string,
	devTools?: DevToolPolicy,
): ContainerRequest & { containment: Containment.ProcessContainer } {
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
	return {
		containment: { type: "processcontainer" },
		filesystem: {
			readonlyPaths: [
				...new Set([
					...readonly,
					...policy.workspace.readonlyRoots,
					...workspaceVolumeRoots(call.policy.workspaceRoots),
				]),
			].filter((root) => !policy.workspace.writableRoots.includes(root)),
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
			disable: !policy.ui.allowWindows,
			clipboard: "none",
			allowInputInjection: false,
		},
		timeoutMs: call.timeoutMs!,
		command: call.command!.map(quoteWindowsArgument).join(" "),
		workingDirectory: call.cwd,
		environment: { ...env, TEMP: temporary, TMP: temporary },
		inheritDefaultEnvironment: false,
	};
}

/** BaseContainer のドライブ直下 RO は非再帰。cwd 解決に必要な volume handle だけを許可する。 */
export function workspaceVolumeRoots(roots: readonly string[]): string[] {
	return [...new Set(roots.map((root) => win32.parse(root).root))].filter(
		(root) => /^[a-z]:\\$/i.test(root),
	);
}

/** MXC が非再帰で扱うドライブ直下の RO と、通常の再帰的なディレクトリ許可を区別する。 */
export function isVolumeRoot(path: string): boolean {
	return /^[a-z]:[\\/]$/i.test(path);
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
			localhost:
				call.policy.hostLoopbackAccess === true ? "allow" : "deny",
		},
		ui: { allowWindows: true, clipboard: "deny", inputInjection: "deny" },
		devTools: devTools ?? {
			resources: [],
			environment: devToolEnvironment(call.env ?? {}),
			executables: {},
		},
	};
}

// 解決済みエントリーポイントから実行経路を決める。終了コードや空の拒否レポートで Host へ切り替えない。
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import type {
	SandboxCompatibilityEvent,
	CommandPermissionKey,
} from "@nerita/shared/commandPermission";
import { classifyToolCommand } from "./LogicalToolCommand";

/** Host の検出器だけが作る起動情報。モデルから実行ファイルを指定させない。 */
export type LogicalToolInvocation = {
	tool: string;
	entrypoint: string;
	args: readonly string[];
	workspace: string;
};

/** 経路選択だけを返す。Host の選択は実行許可を意味せず、必ず別途承認する。 */
export function toolExecutionRoute(
	invocation: LogicalToolInvocation,
	backend: "mxc" | "docker",
): {
	permission: CommandPermissionKey;
	compatibility?: SandboxCompatibilityEvent;
} {
	const nativePnpm =
		backend === "mxc" &&
		invocation.tool === "pnpm" &&
		extname(invocation.entrypoint).toLowerCase() === ".exe";
	const permission: CommandPermissionKey = {
		tool: invocation.tool,
		commandClass: classifyToolCommand(invocation.tool, invocation.args),
		workspace: invocation.workspace,
		route: nativePnpm ? "host" : backend,
	};
	return {
		permission,
		...(nativePnpm
			? {
					compatibility: {
						id: randomUUID(),
						permission,
						backend,
						code: "native-pnpm-dos-path" as const,
						reason: "ネイティブ版 pnpm は MXC 内の DOS パス正規化に対応していません。ホスト実行には別途承認が必要です。",
					},
				}
			: {}),
	};
}

// 同梱した MXC を ESM として読み込み、ネイティブ資産と worker の相対参照を維持する。
import { z } from "zod";
import { isRecord } from "@nerita/shared/validation";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as Sdk from "@microsoft/mxc-sdk";

export type MxcSdk = typeof Sdk & {
	launcherPath: string;
	resolveLaunch: (config: Sdk.ContainerConfig) => {
		executablePath: string;
		args: string[];
	};
};

/** Node の要件不足を、App Server や非 Sandbox 実行へ切り替えずに通知する。 */
export async function loadMxcSdk(extensionPath: string): Promise<MxcSdk> {
	if (process.platform !== "win32" || process.arch !== "x64") {
		throw new Error("Microsoft MXC は Windows x64 で利用できます。");
	}
	if (Number(process.versions.node.split(".")[0]) < 24) {
		throw new Error(
			`Microsoft MXC SDK には Node.js 24 以上が必要です（現在 ${process.versions.node}）。`,
		);
	}
	const url = pathToFileURL(
		join(
			extensionPath,
			"dist/runtime/node_modules/@microsoft/mxc-sdk/dist/index.js",
		),
	);
	const sdk = z
		.custom<typeof Sdk>(
			(value) =>
				isRecord(value) &&
				[
					"createConfigFromPolicy",
					"getPlatformSupport",
					"provisionSandbox",
					"startSandbox",
					"stopSandbox",
					"deprovisionSandbox",
				].every((name) => typeof value[name] === "function"),
		)
		.parse(await import(url.href));
	const helper = z
		.custom<{ resolveExecutableAndArgs: MxcSdk["resolveLaunch"] }>(
			(value) =>
				isRecord(value) &&
				typeof value.resolveExecutableAndArgs === "function",
		)
		.parse(await import(new URL("./helper.js", url).href));
	return {
		...sdk,
		launcherPath: join(
			extensionPath,
			"dist/runtime/nerita-mxc-launcher.ps1",
		),
		resolveLaunch: helper.resolveExecutableAndArgs,
	};
}

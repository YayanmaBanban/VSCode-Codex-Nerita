// 同梱した MXC を ESM として読み込み、ネイティブ資産と worker の相対参照を維持する。
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as Sdk from "@microsoft/mxc-sdk";

export type MxcSdk = typeof Sdk;

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
	return import(url.href) as Promise<MxcSdk>;
}

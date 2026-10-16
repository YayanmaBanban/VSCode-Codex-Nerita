// 同梱した MXC を ESM として読み込み、ネイティブ資産と worker の相対参照を維持する。
import { z } from "zod";
import { isRecord } from "@nerita/shared/validation";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as Sdk from "@microsoft/mxc-sdk/v1";

/** 同梱した V1 SDK の公開 API だけを実行・診断に使う。 */
export type MxcSdk = typeof Sdk;

/** Node の要件不足を、App Server や非 Sandbox 実行へ切り替えずに通知する。 */
export async function loadMxcSdk(extensionPath: string): Promise<MxcSdk> {
	if (process.platform !== "win32" || process.arch !== "x64") {
		throw new Error("Microsoft MXC の実行には Windows x64 が必要です。");
	}
	const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
	const supported24 = major === 24 && minor >= 21;
	const supported26 = major === 26 && minor >= 8;
	const supported = supported24 || supported26 || major > 26;
	if (!supported) {
		throw new Error(
			`Microsoft MXC の標準入出力には Node.js 24.21 以降または 26.8 以降が必要です（現在 ${process.versions.node}）。`,
		);
	}
	const url = pathToFileURL(
		join(
			extensionPath,
			"dist/runtime/node_modules/@microsoft/mxc-sdk/dist/v1/index.js",
		),
	);
	return z
		.custom<typeof Sdk>(
			(value) =>
				isRecord(value) &&
				[
					"spawn",
					"getPlatformSupport",
					"getAvailableBackends",
					"probe",
				].every((name) => typeof value[name] === "function"),
		)
		.parse(await import(url.href));
}

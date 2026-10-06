// 同梱 ESM の読み込みと公開 API の存在確認を、Pi の利用箇所で共有する。
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import { isRecord } from "@nerita/shared/validation";
import { z } from "zod";

type RuntimePiSdk = typeof PiSdk & {
	getSupportedThinkingLevels(
		model: NonNullable<PiSdk.AgentSession["model"]>,
	): string[];
};

// 関数の型はビルド元の SDK に従い、読み込み時には配布入口に必要なエクスポートがあることを確認する。
const sdkSchema = z.custom<RuntimePiSdk>(
	(value) =>
		isRecord(value) &&
		[
			"getAgentDir",
			"ModelRuntime",
			"SettingsManager",
			"SessionManager",
			"createAgentSession",
			"getSupportedThinkingLevels",
		].every((name) => typeof value[name] === "function"),
);

/** ユーザー環境の SDK を探索せず、指定された拡張の配布物を読む。 */
export async function loadPiSdk(extensionPath: string): Promise<RuntimePiSdk> {
	const url = pathToFileURL(join(extensionPath, "dist/runtime/pi.mjs"));
	return sdkSchema.parse(await import(url.href));
}

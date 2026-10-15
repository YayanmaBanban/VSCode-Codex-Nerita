// 設定 RPC から、信頼管理とサンドボックスの既定値適用に使う項目を検証する。
import { isRecord } from "@nerita/shared/validation";
import { z } from "zod";

const trustConfig = z.object({
	config: z.object({
		projects: z
			.record(
				z.string(),
				z.object({
					trust_level: z.enum(["trusted", "untrusted"]).nullish(),
				}),
			)
			.nullish(),
	}),
	layers: z
		.array(
			z.object({
				name: z.object({
					type: z.string(),
					dotCodexFolder: z.string().optional(),
				}),
				disabledReason: z.string().nullish(),
			}),
		)
		.nullish(),
});

/** 設定の読取りを共有し、信頼情報と Windows 設定をそれぞれ検証する。 */
export function parseConfig(value: unknown) {
	const parsed = trustConfig.parse(value);
	return {
		...parseSandboxConfig(value),
		projects: parsed.config.projects ?? {},
		layers: parsed.layers ?? [],
	};
}

/** 書込みの成功状態と保存先を検証し、上書きの有無を呼出し側へ渡す。 */
export function parseConfigWrite(value: unknown) {
	return z
		.object({
			status: z.enum(["ok", "okOverridden"]),
			version: z.string(),
			filePath: z.string(),
		})
		.parse(value);
}

/** 将来の実装名も明示設定として扱い、VS Code 設定で上書きしない。 */
export function parseSandboxConfig(value: unknown): { sandbox: string | null } {
	if (!isRecord(value) || !isRecord(value.config)) {
		throw new Error("Codexの設定応答が不正です。");
	}
	const windows = value.config.windows;
	if (windows === undefined || windows === null) {
		return { sandbox: null };
	}
	if (!isRecord(windows)) {
		throw new Error("CodexのWindows設定が不正です。");
	}
	const sandbox = windows.sandbox;
	if (sandbox === undefined || sandbox === null) {
		return { sandbox: null };
	}
	if (typeof sandbox !== "string" || sandbox === "") {
		throw new Error("CodexのSandbox設定が不正です。");
	}
	return { sandbox };
}

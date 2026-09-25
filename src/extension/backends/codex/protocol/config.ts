// サンドボックスの既定値適用に必要な有効設定だけを検証する。
import { isRecord } from "../../../../shared/validation";

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
	if (typeof sandbox !== "string" || !sandbox) {
		throw new Error("CodexのSandbox設定が不正です。");
	}
	return { sandbox };
}

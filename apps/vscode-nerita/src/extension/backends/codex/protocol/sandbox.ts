// 会話開始時のサンドボックスを検証し、元の権限へ戻すために保持する。
import type { SandboxPolicy } from "../codex-app-server/v2/SandboxPolicy";
import { isRecord } from "@nerita/shared/validation";
/** 利用する全フィールドを検証してサンドボックスを返す。 */
export function parseSandbox(value: unknown): SandboxPolicy {
	if (!isRecord(value)) {
		throw new Error("Invalid sandbox");
	}
	if (value.type === "dangerFullAccess") {
		return { type: "dangerFullAccess" };
	}
	if (value.type === "externalSandbox") {
		if (value.networkAccess === "enabled") {
			return {
				type: "externalSandbox",
				networkAccess: value.networkAccess,
			};
		}
		if (value.networkAccess === "restricted") {
			return {
				type: "externalSandbox",
				networkAccess: value.networkAccess,
			};
		}
	}
	if (value.type === "readOnly" && typeof value.networkAccess === "boolean") {
		return { type: "readOnly", networkAccess: value.networkAccess };
	}
	return parseWritableSandbox(value);
}

/** 書き込み可能なサンドボックスの全設定を検証する。 */
function parseWritableSandbox(value: Record<string, unknown>): SandboxPolicy {
	if (value.type !== "workspaceWrite") {
		throw new Error("Invalid sandbox");
	}
	if (!Array.isArray(value.writableRoots)) {
		throw new Error("Invalid sandbox");
	}
	if (!containsOnlyStrings(value.writableRoots)) {
		throw new Error("Invalid sandbox");
	}
	if (typeof value.networkAccess !== "boolean") {
		throw new Error("Invalid sandbox");
	}
	if (typeof value.excludeTmpdirEnvVar !== "boolean") {
		throw new Error("Invalid sandbox");
	}
	if (typeof value.excludeSlashTmp !== "boolean") {
		throw new Error("Invalid sandbox");
	}
	return {
		type: "workspaceWrite",
		writableRoots: value.writableRoots,
		networkAccess: value.networkAccess,
		excludeTmpdirEnvVar: value.excludeTmpdirEnvVar,
		excludeSlashTmp: value.excludeSlashTmp,
	};
}

/** 配列の各要素も検証し、未知の値を権限パスとして公開しない。 */
function containsOnlyStrings(values: unknown[]): values is string[] {
	return values.every((value) => typeof value === "string");
}

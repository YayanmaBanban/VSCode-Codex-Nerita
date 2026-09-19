// 会話開始時のsandboxを検証し、元の権限へ戻すために保持する。
import type { SandboxPolicy } from "../../../codex-app-server/v2/SandboxPolicy";
import { isRecord } from "../../../shared/validation";
/** 利用する全フィールドを検証してsandboxを返す。 */
export function parseSandbox(value: unknown): SandboxPolicy {
	if (!isRecord(value)) {
		throw new Error("Invalid sandbox");
	}
	if (value.type === "dangerFullAccess") {
		return { type: "dangerFullAccess" };
	}
	if (
		value.type === "externalSandbox" &&
		(value.networkAccess === "enabled" ||
			value.networkAccess === "restricted")
	) {
		return { type: "externalSandbox", networkAccess: value.networkAccess };
	}
	if (value.type === "readOnly" && typeof value.networkAccess === "boolean") {
		return { type: "readOnly", networkAccess: value.networkAccess };
	}
	if (
		value.type === "workspaceWrite" &&
		Array.isArray(value.writableRoots) &&
		value.writableRoots.every(
			(path: unknown) => typeof path === "string",
		) &&
		typeof value.networkAccess === "boolean" &&
		typeof value.excludeTmpdirEnvVar === "boolean" &&
		typeof value.excludeSlashTmp === "boolean"
	) {
		return {
			type: "workspaceWrite",
			writableRoots: value.writableRoots,
			networkAccess: value.networkAccess,
			excludeTmpdirEnvVar: value.excludeTmpdirEnvVar,
			excludeSlashTmp: value.excludeSlashTmp,
		};
	}
	throw new Error("Invalid sandbox");
}

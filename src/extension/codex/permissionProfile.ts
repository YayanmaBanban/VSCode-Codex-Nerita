// 追加権限の要求を検証し、ユーザーが確認した今回の権限だけを返す。
import type { GrantedPermissionProfile } from "../../codex-app-server/v2/GrantedPermissionProfile";
import { isRecord } from "../../shared/validation";
import { AppServerRpcError } from "./rpcMessage";
import type { FileSystemSandboxEntry } from "../../codex-app-server/v2/FileSystemSandboxEntry";
import type { FileSystemPath } from "../../codex-app-server/v2/FileSystemPath";

/** 権限のパス表現を生成型の既知の形式へ限定する。 */
function permissionPath(value: unknown): FileSystemPath {
	if (!isRecord(value)) {
		throw new AppServerRpcError(-32602, "Invalid permission path");
	}
	if (value.type === "path" && typeof value.path === "string") {
		return { type: "path", path: value.path };
	}
	if (value.type === "glob_pattern" && typeof value.pattern === "string") {
		return { type: "glob_pattern", pattern: value.pattern };
	}
	if (value.type === "special" && isRecord(value.value)) {
		const p = value.value;
		if (
			p.kind === "root" ||
			p.kind === "minimal" ||
			p.kind === "tmpdir" ||
			p.kind === "slash_tmp"
		) {
			return { type: "special", value: { kind: p.kind } };
		}
		if (
			p.kind === "project_roots" &&
			(p.subpath === null || typeof p.subpath === "string")
		) {
			return {
				type: "special",
				value: { kind: "project_roots", subpath: p.subpath },
			};
		}
	}
	throw new AppServerRpcError(-32602, "Unsupported permission path");
}

/** 互換read/writeとネットワーク権限を検証し、未知の広い権限形式を許可しない。 */
export function permissionProfile(value: unknown): GrantedPermissionProfile {
	if (!isRecord(value)) {
		throw new AppServerRpcError(-32602, "Invalid permissions");
	}
	const result: GrantedPermissionProfile = {};
	if (value.network !== null && value.network !== undefined) {
		if (
			!isRecord(value.network) ||
			!(
				value.network.enabled === null ||
				typeof value.network.enabled === "boolean"
			)
		) {
			throw new AppServerRpcError(-32602, "Invalid network permission");
		}
		result.network = { enabled: value.network.enabled };
	}
	if (value.fileSystem !== null && value.fileSystem !== undefined) {
		const fs = value.fileSystem;
		if (
			!isRecord(fs) ||
			(fs.entries !== undefined && !Array.isArray(fs.entries)) ||
			(fs.globScanMaxDepth !== undefined &&
				(!Number.isSafeInteger(fs.globScanMaxDepth) ||
					Number(fs.globScanMaxDepth) < 0))
		) {
			throw new AppServerRpcError(
				-32602,
				"Unsupported filesystem permission",
			);
		}
		const paths = (value: unknown): string[] | null => {
			if (value === null) {
				return null;
			}
			if (
				!Array.isArray(value) ||
				!value.every((path: unknown) => typeof path === "string")
			) {
				throw new AppServerRpcError(-32602, "Invalid permission paths");
			}
			return value;
		};
		result.fileSystem = { read: paths(fs.read), write: paths(fs.write) };
		if (Array.isArray(fs.entries)) {
			result.fileSystem.entries = fs.entries.map(
				(entry: unknown): FileSystemSandboxEntry => {
					if (
						!isRecord(entry) ||
						(entry.access !== "read" &&
							entry.access !== "write" &&
							entry.access !== "deny")
					) {
						throw new AppServerRpcError(
							-32602,
							"Invalid permission entry",
						);
					}
					return {
						path: permissionPath(entry.path),
						access: entry.access,
					};
				},
			);
		}
		if (typeof fs.globScanMaxDepth === "number") {
			result.fileSystem.globScanMaxDepth = fs.globScanMaxDepth;
		}
	}
	return result;
}

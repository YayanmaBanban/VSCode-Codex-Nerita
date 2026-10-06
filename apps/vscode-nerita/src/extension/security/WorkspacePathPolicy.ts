// 実在する祖先と正規化されたパスを確認し、Host ファイルツールの書込み境界を検査する。
import { fsErrorCode } from "../runtime/FsError";
import { lstat, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { containsPath, type AgentAccessPolicy } from "./AgentAccessPolicy";
import { freezeToolCall } from "./ApprovedToolCall";

/** デバイス名前空間・ADS・ドライブ相対名などの別解釈を許さない。 */
export function validatePath(path: string) {
	if (path === "" || path.includes("\0")) {
		throw new Error("不正なファイルパスです。");
	}
	if (
		process.platform === "win32" &&
		(/^[\\/]{2}/.test(path) ||
			/^[a-z]:(?![\\/])/i.test(path) ||
			/[:<>"|?*]/.test(path.replace(/^[a-z]:[\\/]/i, "")) ||
			[...path].some((c) => c.charCodeAt(0) < 32) ||
			path
				.split(/[\\/]/)
				.some(
					(p) =>
						(/[ .]$/.test(p) && p !== "." && p !== "..") ||
						/^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(
							p,
						),
				))
	) {
		throw new Error("Windowsの特殊パスは許可されていません。");
	}
}

/** `ENOENT` だけを新規パスと扱い、壊れたリンク・権限不足は呼出元へ返す。 */
export async function canonicalPath(
	input: string,
	cwd: string,
): Promise<string> {
	validatePath(input);
	const absolute = resolve(cwd, input);
	validatePath(absolute);
	let ancestor = absolute;
	const missing: string[] = [];
	while (true) {
		let exists = false;
		try {
			await lstat(ancestor);
			exists = true;
		} catch (error) {
			if (fsErrorCode(error) !== "ENOENT") {
				throw error;
			}
		}
		if (exists) {
			return join(await realpath(ancestor), ...missing);
		}
		const parent = dirname(ancestor);
		if (parent === ancestor) {
			throw new Error("パスの実在する祖先を解決できません。");
		}
		missing.unshift(basename(ancestor));
		ancestor = parent;
	}
}

/** `Workspace Trust` を通過した Host の `roots` をコピーして固定する。 */
export async function createWorkspaceAccessPolicy(
	roots: readonly string[],
): Promise<AgentAccessPolicy> {
	if (roots.length === 0) {
		throw new Error("workspace rootsを解決できません。");
	}
	const canonical = await Promise.all(
		roots.map(async (root) => {
			validatePath(root);
			if (!isAbsolute(root) || !(await stat(root)).isDirectory()) {
				throw new Error("workspace rootが不正です。");
			}
			return realpath(root);
		}),
	);
	return freezeToolCall({
		workspaceRoots: [...new Set(canonical)],
		writableRoots: [...new Set(canonical)],
		shell: true,
		networkAccess: false,
	});
}

/** 指定された読取り範囲と書込み範囲を、リンク解決後の実体パスへ適用する。 */
export class WorkspacePathPolicy {
	readonly policy: AgentAccessPolicy;
	constructor(
		policy: AgentAccessPolicy,
		readonly cwd: string,
	) {
		this.policy = freezeToolCall(policy);
	}
	/** `cwd` はワークスペース内に限定し、シェルでの暗黙 `write` 拡大を別途検査する。 */
	async resolveWorkspace(input: string): Promise<string> {
		const target = await this.resolve(input, "read");
		if (
			!this.policy.workspaceRoots.some((root) =>
				containsPath(root, target),
			)
		) {
			throw new Error("cwdがworkspace境界外です。");
		}
		return target;
	}
	/** 検査済みの実体 `path` そのものを SDK `operations` へ渡す。 */
	async resolve(input: string, operation: "read" | "write"): Promise<string> {
		const target = await canonicalPath(input, this.cwd);
		if (operation === "read" && !readablePath(this.policy, target)) {
			throw new Error(`読取り許可の範囲外です: ${input}`);
		}
		if (operation === "write") {
			if (
				!this.policy.writableRoots.some((root) =>
					containsPath(root, target),
				) ||
				this.policy.workspaceRoots.includes(target)
			) {
				throw new Error(
					`workspace境界外またはroot自体への書込みは拒否されました: ${input}`,
				);
			}
			try {
				const info = await stat(target);
				if (!info.isFile() || info.nlink > 1) {
					throw new Error(
						"通常ファイル以外・複数hard linkへの書込みは拒否されました。",
					);
				}
			} catch (error) {
				if (fsErrorCode(error) !== "ENOENT") {
					throw error;
				}
			}
		}
		return target;
	}
}

/** 読取り境界を明示した Pi のポリシーだけを制限する。 */
function readablePath(policy: AgentAccessPolicy, target: string): boolean {
	return (
		!policy.readableRoots ||
		policy.readableRoots.some((root) => containsPath(root, target))
	);
}

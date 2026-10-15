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
	if (process.platform === "win32" && isWindowsSpecialPath(path)) {
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
			throw new Error("指定パス、またはその上位フォルダの実際の場所を確認できません。");
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
		throw new Error("アクセスを許可するワークスペースのルートフォルダが指定されていません。");
	}
	const canonical = await Promise.all(
		roots.map(async (root) => {
			validatePath(root);

			if (!isAbsolute(root)) {
				throw new Error("ワークスペースのルートフォルダは絶対パスで指定してください。");
			}
			const rootInfo = await stat(root);
			if (!rootInfo.isDirectory()) {
				throw new Error("ワークスペースのルートにはフォルダを指定してください。");
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
	/** 開始時の権限を固定し、呼び出し側による後の変更でパスの上限を広げない。 */
	constructor(
		policy: AgentAccessPolicy,
		readonly cwd: string,
	) {
		this.policy = freezeToolCall(policy);
	}
	/** `cwd` はワークスペース内に限定し、シェルでの暗黙 `write` 拡大を別途検査する。 */
	async resolveWorkspace(input: string): Promise<string> {
		const target = await this.resolve(input, "read");
		const matchesSome = !this.policy.workspaceRoots.some((root) =>
			containsPath(root, target),
		);
		if (matchesSome) {
			throw new Error("作業フォルダがワークスペースの範囲外にあります。");
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
			const matchesSome2 =
				!this.policy.writableRoots.some((root) =>
					containsPath(root, target),
				) || this.policy.workspaceRoots.includes(target);
			if (matchesSome2) {
				throw new Error(
					`書き込みが許可された範囲の外、またはワークスペースのルート自体には書き込めません: ${input}`,
				);
			}
			try {
				const info = await stat(target);
				if (!info.isFile() || info.nlink > 1) {
					throw new Error(
						"通常のファイル以外、またはハードリンクが複数あるファイルには書き込めません。",
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

/** Windows が別の対象として解釈する区切り・制御文字・予約名を検出する。 */
function isWindowsSpecialPath(path: string): boolean {
	const matchesTest =
		/^[\\/]{2}/.test(path) ||
		/^[a-z]:(?![\\/])/i.test(path) ||
		/[:<>"|?*]/.test(path.replace(/^[a-z]:[\\/]/i, ""));
	if (matchesTest) {
		return true;
	}
	const hasControlCharacter = [...path].some(
		(char) => char.charCodeAt(0) < 32,
	);
	if (hasControlCharacter) {
		return true;
	}
	return path.split(/[\\/]/).some(isWindowsSpecialSegment);
}

/** Windows が末尾を省略する名前と予約されたデバイス名を拒否し、相対パスの . と .. は別に扱う。 */
function isWindowsSpecialSegment(segment: string): boolean {
	if (/[ .]$/.test(segment) && segment !== "." && segment !== "..") {
		return true;
	}
	return /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(
		segment,
	);
}

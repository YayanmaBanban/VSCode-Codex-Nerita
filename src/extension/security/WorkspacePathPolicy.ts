// 実在する祖先を解決し、新規ファイルとjunctionにも同じ境界検査を適用する。
import { lstat, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";
import { homedir } from "node:os";
import { containsPath, type AgentAccessPolicy } from "./AgentAccessPolicy";

/** Windowsの別名・device namespace・ADSを曖昧に解釈させない。 */
function validatePath(path: string) {
	if (!path || path.includes("\0")) {
		throw new Error("不正なファイルパスです。");
	}
	if (
		process.platform === "win32" &&
		(/^[\\/]{2}/.test(path) ||
			/^[a-z]:(?![\\/])/i.test(path) ||
			/[:<>"|?*]/.test(path.replace(/^[a-z]:[\\/]/i, "")) ||
			[...path].some((character) => character.charCodeAt(0) < 32) ||
			path
				.split(/[\\/]/)
				.some(
					(p) =>
						(/[ .]$/.test(p) && p !== "." && p !== "..") ||
						/^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(
							p,
						),
				))
	) {
		throw new Error("Windowsの特殊パスは許可されていません。");
	}
}

/** ENOENTだけを新規パスとみなし、壊れたsymlink・アクセス失敗は拒否する。 */
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
		if (await entryExists(ancestor)) {
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

/** realpathの失敗は呼出元へ返し、dangling linkを新規パスと誤認しない。 */
async function entryExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

/** 起動時に全rootを確定し、rootやhome全体の書込み権限を作らない。 */
export async function createWorkspaceAccessPolicy(
	roots: readonly string[],
): Promise<AgentAccessPolicy> {
	if (!roots.length) {
		throw new Error("workspace rootsを解決できません。");
	}
	const canonical = await Promise.all(
		roots.map(async (root) => {
			validatePath(root);
			if (!isAbsolute(root) || !(await stat(root)).isDirectory()) {
				throw new Error("workspace rootが不正です。");
			}
			const path = await realpath(root);
			if (
				path === parse(path).root ||
				containsPath(path, await realpath(homedir()))
			) {
				throw new Error("root / home全体をworkspaceにできません。");
			}
			return path;
		}),
	);
	const protectedPaths = await Promise.all(
		[".ssh", ".aws", ".azure", ".codex", ".pi/agent"].map((p) =>
			canonicalPath(join(homedir(), p), homedir()),
		),
	);
	const codexHome = process.env.CODEX_HOME;
	if (codexHome) {
		// App Serverのcwdで意味が変わる相対指定を推測して許可しない。
		if (!isAbsolute(codexHome)) {
			throw new Error("CODEX_HOMEは絶対パスで指定してください。");
		}
		protectedPaths.push(await canonicalPath(codexHome, homedir()));
	}
	return {
		filesystem: {
			readableRoots: canonical,
			writableRoots: canonical,
			protectedPaths,
		},
		network: { enabled: false },
		// Shellにも読取り上限を維持する。現在のWindows実装は権限profileでも
		// root読取りを要求するため、強制可能なExecutorが用意されるまで停止する。
		command: { mode: "deny" },
	};
}

/** pathを返すことで、検査したcanonical pathそのものをツールへ渡す。 */
export class WorkspacePathPolicy {
	constructor(
		readonly policy: AgentAccessPolicy,
		readonly cwd: string,
	) {}

	/** 承認前・実行直前・個別ファイル操作の各境界で呼び出す。 */
	async resolve(input: string, operation: "read" | "write"): Promise<string> {
		const target = await canonicalPath(input, this.cwd);
		const roots =
			operation === "write"
				? this.policy.filesystem.writableRoots
				: this.policy.filesystem.readableRoots;
		if (
			!roots.some((root) => containsPath(root, target)) ||
			this.policy.filesystem.protectedPaths.some((root) =>
				containsPath(root, target),
			)
		) {
			throw new Error(
				`workspace境界外または保護対象の${operation}は拒否されました: ${input}`,
			);
		}
		if (operation === "write") {
			if (roots.includes(target)) {
				throw new Error("workspace root自体は変更できません。");
			}
		}
		try {
			const info = await stat(target);
			if (info.isFile() && info.nlink > 1) {
				throw new Error(
					"複数のhard linkを持つファイルは操作できません。",
				);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
		}
		return target;
	}
}

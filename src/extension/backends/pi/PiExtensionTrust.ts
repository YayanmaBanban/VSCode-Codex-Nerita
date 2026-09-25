// Host コードのロード許可はユーザー設定の正規化された単一ファイルだけから解決する。
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { containsPath } from "../../security/AgentAccessPolicy";
import { validatePath } from "../../security/WorkspacePathPolicy";

/** ワークスペース側の同名設定は信頼の昇格に使用しない。 */
export function userTrustedExtensionPaths(
	setting: { globalValue?: string[] } | undefined,
): string[] {
	return [...(setting?.globalValue ?? [])];
}

/** ディレクトリ指定やリンク別名は拒否し、新しい `entry` の暗黙ロードを防ぐ。 */
export async function resolveTrustedExtensions(
	paths: readonly string[],
	roots: readonly string[],
	workspaceTrusted: boolean,
): Promise<string[]> {
	const result = [];
	for (const input of paths) {
		validatePath(input);
		if (!isAbsolute(input)) {
			throw new Error(
				`信頼するPi拡張は絶対ファイルパスで指定してください: ${input}`,
			);
		}
		let path: string;
		try {
			path = await realpath(input);
		} catch (error) {
			throw new Error(`Pi拡張は未導入か参照できません: ${input}`, {
				cause: error,
			});
		}
		if (path !== resolve(input) || !(await stat(path)).isFile()) {
			throw new Error(
				`信頼するPi拡張はcanonicalな単一ファイルで指定してください: ${input}`,
			);
		}
		if (
			!workspaceTrusted &&
			roots.some((root) => containsPath(root, path))
		) {
			throw new Error(
				"workspace内のPi拡張にはWorkspace Trustも必要です。",
			);
		}
		result.push(path);
	}
	return [...new Set(result)];
}

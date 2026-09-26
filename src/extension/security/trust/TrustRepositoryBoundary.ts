// 明示登録した root の内側にある別リポジトリへ、親の信頼を暗黙に引き継がせない。
import { lstat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { containsPath } from "../AgentAccessPolicy";

/** clone の通知を取りこぼしても、内側の Git 境界が未登録なら実行を拒否する。 */
export async function hasNestedRepository(
	root: string,
	target: string,
): Promise<boolean> {
	let directory = target;
	for (let depth = 0; depth < 256 && containsPath(root, directory); depth++) {
		if (relative(root, directory) === "") {
			return false;
		}
		try {
			await lstat(join(directory, ".git"));
			return true;
		} catch (error) {
			if (
				!["ENOENT", "ENOTDIR"].includes(
					(error as NodeJS.ErrnoException).code ?? "",
				)
			) {
				return true;
			}
		}
		directory = dirname(directory);
	}
	return true;
}

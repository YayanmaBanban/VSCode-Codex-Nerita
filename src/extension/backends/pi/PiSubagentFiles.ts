// 再帰的な定義探索を上限付きで行い、リンクによる範囲外読取りを防ぐ。
import { readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { containsPath } from "../../security/AgentAccessPolicy";

/** 保存ワークフローを除外し、Markdown のエージェント定義だけを返す。 */
export async function subagentFiles(root: string): Promise<string[]> {
	const files: string[] = [];
	const visited = new Set<string>();
	const pending = [root];
	while (pending.length) {
		const directory = pending.pop()!;
		if (visited.has(directory)) {
			continue;
		}
		visited.add(directory);
		if (visited.size > 128) {
			throw new Error(
				"サブエージェント定義のディレクトリ数が上限を超えています。",
			);
		}
		for (const name of (await readdir(directory)).sort()) {
			const file = await realpath(join(directory, name));
			if (!containsPath(root, file)) {
				throw new Error("サブエージェント定義が範囲外です。");
			}
			const info = await stat(file);
			if (info.isDirectory()) {
				pending.push(file);
			} else if (name.endsWith(".md") && !name.endsWith(".chain.md")) {
				files.push(file);
			}
		}
		if (files.length > 128) {
			throw new Error("サブエージェント定義の件数が上限を超えています。");
		}
	}
	return [...new Set(files)].sort();
}

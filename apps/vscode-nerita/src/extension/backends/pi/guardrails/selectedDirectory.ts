// フォルダ選択結果をワークスペース内に限定し、共有可能な相対パスへ変換する。
import { realpath, stat } from "node:fs/promises";
import { relative } from "node:path";
import { containsPath } from "../../../security/AgentAccessPolicy";
import { pathRuleSchema } from "@nerita/shared/guardrails/config";

/** 表記とリンク先の両方を検査し、絶対パスや外部へのリンクを設定へ持ち込まない。 */
export async function selectedDirectory(
	root: string,
	selected: string,
): Promise<string> {
	const [canonicalRoot, canonicalSelected, info] = await Promise.all([
		realpath(root),
		realpath(selected),
		stat(selected),
	]);
	const invalid =
		!info.isDirectory() ||
		!containsPath(root, selected) ||
		!containsPath(canonicalRoot, canonicalSelected);
	if (invalid) {
		throw new Error(
			"このワークスペース内のディレクトリを選択してください。",
		);
	}
	const path = relative(root, selected).replaceAll("\\", "/");
	return pathRuleSchema.shape.directory.parse(path === "" ? "." : path);
}

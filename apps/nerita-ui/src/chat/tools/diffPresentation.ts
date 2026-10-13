// 差分の変更数・行番号・対象パスを入力形式によらず揃える。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import type { structuredPatch } from "diff";
import type { UiMessage } from "@nerita/shared/messages";

/** 文脈行を含む1つの変更ブロック。 */
export type DiffHunk = ReturnType<typeof structuredPatch>["hunks"][number];
/** 相対パスの基準と Host の差分を開く操作。 */
export type DiffLocationProps = {
	path: string;
	cwd?: string | null | undefined;
	send?: ((message: UiMessage) => void) | undefined;
};

/** 文脈行を含めず、追加と削除の数だけを返す。 */
export function changeCount(lines: string[]) {
	return {
		added: lines.filter((line) => line.startsWith("+")).length,
		removed: lines.filter((line) => line.startsWith("-")).length,
	};
}

/** 変更前後で存在する側の範囲と、表示に使う1つの行番号を求める。 */
export function hunkPresentation(hunk: DiffHunk) {
	const starts: number[] = [];
	const ends: number[] = [];
	if (hunk.oldLines > 0) {
		starts.push(hunk.oldStart);
		ends.push(hunk.oldStart + hunk.oldLines);
	}
	if (hunk.newLines > 0) {
		starts.push(hunk.newStart);
		ends.push(hunk.newStart + hunk.newLines);
	}
	const start = Math.min(...starts);
	const end = Math.max(...ends);
	let oldLine = hunk.oldStart;
	let newLine = hunk.newStart;
	/** 追加・削除・文脈行で元と新しい行番号を進める。 */
	const numberDiffLine = (line: string) => {
		const marker = line[0];
		let number: number | null = marker === "-" ? oldLine : newLine;
		if (marker === "\\") {
			number = null;
		}
		if (marker === "-" || marker === " ") {
			oldLine++;
		}
		if (marker === "+" || marker === " ") {
			newLine++;
		}
		return { line, number };
	};
	const numbered = hunk.lines.map(numberDiffLine);
	return {
		range: `L${start}–${end}`,
		digits: String(end - 1).length,
		numbered,
	};
}

/** 区切り・`.`・`..` を整理し、作業ディレクトリで相対パスを解決する。 */
export function diffPath(path: string, cwd?: string | null) {
	const normalized = path.replaceAll("\\", "/");
	const absolute =
		normalized.startsWith("/") || /^[a-z]:\//i.test(normalized);
	const full =
		!absolute && isNonEmptyString(cwd)
			? `${cwd.replaceAll("\\", "/")}/${normalized}`
			: normalized;
	const parts: string[] = [];
	for (const part of full.split("/")) {
		if (part === ".") {
			continue;
		}
		if (part === ".." && parts.length > 1) {
			parts.pop();
		} else {
			parts.push(part);
		}
	}
	return parts.join("/");
}

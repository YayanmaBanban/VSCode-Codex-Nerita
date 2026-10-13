// 差分の変更数・行番号・対象パスを入力形式によらず揃える。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { structuredPatch, parsePatch } from "diff";
import type { UiMessage } from "@nerita/shared/messages";
import type { ToolContent } from "@nerita/shared/toolContent";

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

/** 見出しと本文で共通の処理を使い、計算時間の超過や解析できない差分を `undefined` で返す。 */
export function contentHunks(content: ToolContent): DiffHunk[] | undefined {
	if (content.type === "diff") {
		return structuredPatch(
			content.path,
			content.path,
			content.oldText ?? "",
			content.newText,
			undefined,
			undefined,
			{ context: 3, timeout: 100 },
		)?.hunks;
	}
	if (content.type !== "unifiedDiff") {
		return undefined;
	}
	try {
		const hunks = parsePatch(content.diff).flatMap((patch) => patch.hunks);
		return hunks.length > 0 ? hunks : undefined;
	} catch {
		return undefined;
	}
}

/** ツール全体の変更件数を、表示できる差分のハンクだけから集計する。 */
export function toolChangeCount(content: ToolContent[] | undefined) {
	let total: ReturnType<typeof changeCount> | undefined;
	for (const value of content ?? []) {
		const hunks = contentHunks(value);
		if (!hunks) {
			continue;
		}
		const count = changeCount(hunks.flatMap((hunk) => hunk.lines));
		total = {
			added: (total?.added ?? 0) + count.added,
			removed: (total?.removed ?? 0) + count.removed,
		};
	}
	return total;
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
		range: `${start}:${end}`,
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

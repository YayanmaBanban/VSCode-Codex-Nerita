// 差分の入力形式によらず、ファイル見出し・範囲・行番号を同じ表示に揃える。
import {
	isNonEmptyString,
	nonEmptyString,
} from "@nerita/shared/valuePredicates";
import { cn } from "cnfast";
import type { structuredPatch } from "diff";
import type { ReactNode } from "react";
import type { UiMessage } from "@nerita/shared/messages";
import { SettingsTooltip } from "../SettingsTooltip";
import { diffLineClass, toolCodeClass } from "./toolStyles";

/** 本文から計算した差分と unified diff で共用する、文脈行を含む差分ブロック。 */
export type DiffHunk = ReturnType<typeof structuredPatch>["hunks"][number];

/** 相対パスの解決に使う作業ディレクトリと、Host への送信処理を受け取る。 */
export type DiffLocationProps = {
	path: string;
	cwd?: string | null | undefined;
	send?: ((message: UiMessage) => void) | undefined;
};

/** ファイル全体と差分ブロックごとの変更行数を表示し、解析できない差分の本文も表示できる。 */
export function DiffView({
	path,
	cwd,
	send,
	hunks,
	children,
}: DiffLocationProps & {
	hunks: DiffHunk[] | undefined;
	children?: ReactNode;
}) {
	const name =
		nonEmptyString(path.replaceAll("\\", "/").split("/").at(-1)) ?? path;
	const fullPath = diffPath(path, cwd);
	const total = hunks && changeCount(hunks.flatMap((hunk) => hunk.lines));
	return (
		<section className="tool-diff" aria-label={`${path} の差分`}>
			<div className="my-[8px] flex min-w-0 items-center justify-between gap-[12px] text-[12px]">
				<SettingsTooltip content={fullPath}>
					<button
						type="button"
						aria-label={`${name} の作業ツリー差分を開く`}
						disabled={!send}
						className={cn(
							"border-button-border min-w-0 cursor-pointer truncate rounded-[4px] border border-solid",
							"bg-transparent px-[8px] py-[5px] text-left text-[12px]",
							"focus-visible:outline-2 focus-visible:outline-focus enabled:hover:border-focus",
							"disabled:cursor-default disabled:opacity-60",
						)}
						onClick={() =>
							send?.({
								type: "diff/open",
								requestId: crypto.randomUUID(),
								path: fullPath,
							})
						}
					>
						{name}
					</button>
				</SettingsTooltip>
				{total && <ChangeCount {...total} />}
			</div>
			{hunks?.map((hunk, index) => (
				<HunkView key={index} hunk={hunk} />
			))}
			{children}
		</section>
	);
}

/** 変更前後で行数がある側の範囲をまとめ、終端は最終行の次の行番号で示す（72 行目は `L72–73`）。 */
/* eslint-disable jsx-a11y-x/no-noninteractive-tabindex -- 横に長い差分をキーボードでスクロールするため、表示領域を Tab の対象にする。 */
function HunkView({ hunk }: { hunk: DiffHunk }) {
	const starts = [];
	const ends = [];
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
	const range = `L${start}–${end}`;
	let oldLine = hunk.oldStart;
	let newLine = hunk.newStart;
	const numbered = hunk.lines.map((line) => {
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
	});
	const digits = String(end - 1).length;
	return (
		<div className="file-diff-block my-[8px] overflow-hidden rounded-[4px] border border-solid border-panel-border">
			<div className="file-diff-hunk flex items-center justify-between gap-[12px] bg-diff-hunk px-[8px] py-[4px] font-editor text-[12px] text-muted">
				<span>{range}</span>
				<ChangeCount {...changeCount(hunk.lines)} />
			</div>
			<pre
				role="region"
				className={cn(
					"file-diff-lines",
					toolCodeClass,
					"m-0 overflow-x-auto [overflow-wrap:normal] whitespace-pre",
				)}
				tabIndex={0}
				aria-label={`${range} の差分コード`}
			>
				{numbered.map(({ line, number }, index) => (
					<span
						key={index}
						className={cn(
							diffLineClass,
							line.startsWith("+") &&
								"file-diff-added bg-diff-added",
							line.startsWith("-") &&
								"file-diff-removed bg-diff-removed",
						)}
					>
						<span className="text-muted select-none">
							{String(number ?? "").padStart(digits)}
							{"  "}
						</span>
						{line[0]}
						{line[0] === "\\" ? "" : " "}
						{line.slice(1)}
						{"\n"}
					</span>
				))}
			</pre>
		</div>
	);
}

/** 差分ブロック内の追加行と削除行を数え、文脈行を集計から除く。 */
/* eslint-enable jsx-a11y-x/no-noninteractive-tabindex */
function changeCount(lines: string[]) {
	return {
		added: lines.filter((line) => line.startsWith("+")).length,
		removed: lines.filter((line) => line.startsWith("-")).length,
	};
}

/** 色に加えて記号でも追加・削除を区別する。 */
function ChangeCount({ added, removed }: { added: number; removed: number }) {
	return (
		<span
			className="inline-flex shrink-0 gap-[8px] font-editor tabular-nums"
			aria-label={`${added} 行追加、${removed} 行削除`}
		>
			<span className="text-menu-check">+{added}</span>
			<span className="text-tool-error">-{removed}</span>
		</span>
	);
}

/** パスの区切りと `.`・`..` を整理し、作業ディレクトリがあれば相対パスを解決する。 */
function diffPath(path: string, cwd?: string | null) {
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

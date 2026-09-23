// 貼り付けた絶対パスから、VS Code形式の行・列と行範囲を取り出す。
import { isAbsoluteLocalPath } from "./workspacePaths";
import { isSourceRange, type SourceRange } from "./symbolLocation";

/** コロン形式は1始まり、括弧内の行範囲は0始まりとして扱う。 */
export function parsePastedPath(
	text: string,
): { path: string; range?: SourceRange } | null {
	const value = text.trim();
	const lines = /^(.*)\((\d+):(\d+)\)$/.exec(value);
	const location = lines
		? null
		: /^(.*?):(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?(?: \([^\r\n]*\))?$/.exec(
				value,
			);
	const path = unquotePath(lines, location, value);
	if (!isAbsoluteLocalPath(path)) {
		return null;
	}
	const range: SourceRange | undefined = parsePathRange(lines, location);
	return range && !isSourceRange(range)
		? null
		: { path, ...(range ? { range } : {}) };
}

/** 引用符で囲まれたパスを正規化する。 */
function unquotePath(
	lines: RegExpExecArray | null,
	location: RegExpExecArray | null,
	value: string,
) {
	let path = lines?.[1] ?? location?.[1] ?? value;
	if (path.startsWith('"') && path.endsWith('"')) {
		path = path.slice(1, -1);
	}
	return path;
}

/** 行番号の表記を共通の範囲へ変換する。 */
function parsePathRange(
	lines: RegExpExecArray | null,
	location: RegExpExecArray | null,
) {
	let range: SourceRange | undefined;
	if (lines) {
		range = {
			start: { line: Number(lines[2]), character: 0 },
			end: { line: Number(lines[3]), character: 0 },
		};
	} else if (location) {
		const start = {
			line: Number(location[2]) - 1,
			character: Number(location[3] ?? 1) - 1,
		};
		range = {
			start,
			end: location[4]
				? {
						line: Number(location[4]) - 1,
						character: Number(location[5] ?? 1) - 1,
					}
				: { ...start },
		};
	}
	return range;
}

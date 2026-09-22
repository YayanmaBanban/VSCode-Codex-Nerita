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
	let path = lines?.[1] ?? location?.[1] ?? value;
	if (path.startsWith('"') && path.endsWith('"')) {
		path = path.slice(1, -1);
	}
	if (!isAbsoluteLocalPath(path)) {
		return null;
	}
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
	return range && !isSourceRange(range)
		? null
		: { path, ...(range ? { range } : {}) };
}

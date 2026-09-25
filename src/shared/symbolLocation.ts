// シンボルの位置を VS Code に依存しない形式で共有する。

/** 行・列は VS Code と同じ0始まりで保持する。 */
export type SourcePosition = { line: number; character: number };

/** 定義位置の選択範囲。終端は含まない。 */
export type SourceRange = { start: SourcePosition; end: SourcePosition };

/** 範囲の座標と前後関係を通信・下書き復元時に検証する。 */
export function isSourceRange(value: unknown): value is SourceRange {
	if (!value || typeof value !== "object") {
		return false;
	}
	const range = value as Record<string, unknown>;
	const position = (point: unknown): point is SourcePosition => {
		if (!point || typeof point !== "object") {
			return false;
		}
		const p = point as Record<string, unknown>;
		return [p.line, p.character].every(
			(n) =>
				typeof n === "number" &&
				Number.isSafeInteger(n) &&
				n >= 0 &&
				n <= 2_147_483_647,
		);
	};
	return (
		position(range.start) &&
		position(range.end) &&
		(range.start.line < range.end.line ||
			(range.start.line === range.end.line &&
				range.start.character <= range.end.character))
	);
}

/** VS Code の SymbolKind と定義位置を保持する。 */
export type SymbolLocation = { kind: number; range: SourceRange };

/** シンボルの種別と位置を検証する。 */
export function isSymbolLocation(value: unknown): value is SymbolLocation {
	if (!value || typeof value !== "object") {
		return false;
	}
	const symbol = value as Record<string, unknown>;
	return (
		typeof symbol.kind === "number" &&
		Number.isInteger(symbol.kind) &&
		symbol.kind >= 0 &&
		symbol.kind <= 25 &&
		isSourceRange(symbol.range)
	);
}

// インライン表示するパスと、送信本文内の位置を共有する。
import { isComposerTarget, type ComposerTarget } from "./composerTargets";

/** 通常文の中でチップ表示するパスの開始位置。 */
export type ComposerReference = { offset: number; path: ComposerTarget };

/** 空白を含むパスを引用符で囲み、送信・コピー時の本文を統一する。 */
export function pathText(path: ComposerTarget): string {
	if (path.kind === "changes") {
		return `[Changes: ${path.name}]`;
	}
	if (path.kind === "session") {
		return `[Session: ${path.name}; ID: ${path.sessionId}]`;
	}
	const file = /\s/.test(path.path) ? `"${path.path}"` : path.path;
	if (path.range) {
		const { start, end } = path.range;
		return `${file}:${start.line + 1}:${start.character + 1}-${end.line + 1}:${end.character + 1}`;
	}
	const start = path.symbol?.range.start;
	return start
		? `${file}:${start.line + 1}:${start.character + 1} (${path.name})`
		: file;
}

/** 本文と一致する、重ならないパス参照だけを復元可能にする。 */
export function validReferences(text: string, value: unknown): boolean {
	if (value === undefined) {
		return true;
	}
	if (!Array.isArray(value) || value.length > text.length) {
		return false;
	}

	let end = 0;
	return value.every((item: unknown) => {
		if (!item || typeof item !== "object") {
			return false;
		}
		const reference = item as Record<string, unknown>;
		if (
			!Number.isSafeInteger(reference.offset) ||
			typeof reference.offset !== "number" ||
			reference.offset < end ||
			!isComposerTarget(reference.path)
		) {
			return false;
		}

		const expected = pathText(reference.path);
		end = reference.offset + expected.length;
		return text.slice(reference.offset, end) === expected;
	});
}

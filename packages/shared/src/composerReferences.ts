// 入力文中に表示する参照先と、送信本文内の位置を共有する。
import { isRecord } from "./validation";
import { isComposerTarget, type ComposerTarget } from "./composerTargets";

/** 通常文の中でチップ表示する参照の開始位置。 */
export type ComposerReference = { offset: number; path: ComposerTarget };

/** 参照先を送信・コピー用の文字列に変換し、空白を含むパスは引用符で囲む。 */
export function pathText(path: ComposerTarget): string {
	if (path.kind === "changes") {
		return `[Changes: ${path.name}]`;
	}
	if (path.kind === "session") {
		return `[${path.mode === "handoff" ? "Handoff" : "Session"}: ${path.name}; ID: ${path.sessionId}]`;
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

/** 本文と一致し、位置が重ならない参照だけを復元可能にする。 */
export function validReferences(
	text: string,
	value: unknown,
): value is ComposerReference[] | undefined {
	if (value === undefined) {
		return true;
	}
	if (!Array.isArray(value) || value.length > text.length) {
		return false;
	}

	let end = 0;
	/** 直前の参照末尾から順に照合し、位置の重複と本文との不一致を拒否する。 */
	const validateReference = (item: unknown) => {
		if (!isRecord(item)) {
			return false;
		}
		const reference = item;
		if (!Number.isSafeInteger(reference.offset)) {
			return false;
		}
		if (typeof reference.offset !== "number" || reference.offset < end) {
			return false;
		}
		if (!isComposerTarget(reference.path)) {
			return false;
		}

		const expected = pathText(reference.path);
		end = reference.offset + expected.length;
		return text.slice(reference.offset, end) === expected;
	};
	const matchesEvery = value.every(validateReference);
	return matchesEvery;
}

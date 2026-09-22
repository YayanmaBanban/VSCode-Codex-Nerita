// 下書き内の通常文と貼り付けブロックを、表示先をまたいで保持する。
import { validReferences, type ComposerReference } from "./composerReferences";

/** 入力順と安定した識別子を持つ下書きの断片。 */
export type ComposerPart = {
	id: string;
	type: "text" | "pasted";
	text: string;
	references?: ComposerReference[];
};

/** 送信時の前後空白除去に合わせ、各断片の参照を本文全体の位置へ変換する。 */
export function promptReferences(
	draft: string,
	parts: ComposerPart[],
): ComposerReference[] {
	if (!validDraftParts(draft, parts)) {
		return [];
	}
	let offset = -(draft.length - draft.trimStart().length);
	const references = parts.flatMap((part) => {
		const result = (part.references ?? []).map((reference) => ({
			...reference,
			offset: reference.offset + offset,
		}));
		offset += part.text.length;
		return result;
	});
	return validReferences(draft.trim(), references) ? references : [];
}

/** 旧形式を許容しつつ、本文との一致と交互配置を両側で検証する。 */
export function validDraftParts(draft: string, parts: unknown): boolean {
	if (parts === undefined) {
		return true;
	}
	if (
		!Array.isArray(parts) ||
		!parts.length ||
		parts.length > 201 ||
		parts.length % 2 !== 1
	) {
		return false;
	}

	const ids = new Set<string>();
	return (
		(parts as unknown[]).every((value, index) => {
			if (!value || typeof value !== "object") {
				return false;
			}
			const part = value as Record<string, unknown>;
			if (
				!part ||
				typeof part !== "object" ||
				typeof part.id !== "string" ||
				!part.id ||
				part.id.length > 256 ||
				ids.has(part.id) ||
				part.type !== (index % 2 ? "pasted" : "text") ||
				typeof part.text !== "string" ||
				(part.type === "pasted" && part.references !== undefined) ||
				!validReferences(part.text, part.references)
			) {
				return false;
			}

			ids.add(part.id);
			return true;
		}) &&
		(parts as ComposerPart[]).map((part) => part.text).join("") === draft
	);
}

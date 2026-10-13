// チップの参照先を表示用メタデータへ保存し、UTF-8 の範囲を本文の参照位置へ戻す。
import { isRecord } from "@nerita/shared/validation";
import { isComposerTarget } from "@nerita/shared/composerTargets";
import {
	pathText,
	validReferences,
	type ComposerReference,
} from "@nerita/shared/composerReferences";
import type { TextElement } from "../codex-app-server/v2/TextElement";
import { z } from "zod";

/** 外部履歴の数値範囲を安全な整数に限定する。 */
const byteRangeSchema = z.object({
	start: z.number().int().nonnegative(),
	end: z.number().int().positive(),
});

/** 最終送信本文を基準に保存する。参照先ファイルの範囲は `target` 内に保持する。 */
export function referenceElements(
	text: string,
	references: ComposerReference[],
): TextElement[] {
	if (!validReferences(text, references)) {
		return [];
	}
	return references.map(({ offset, path }) => ({
		byteRange: {
			start: Buffer.byteLength(text.slice(0, offset), "utf8"),
			end: Buffer.byteLength(
				text.slice(0, offset + pathText(path).length),
				"utf8",
			),
		},
		placeholder: JSON.stringify({
			type: "nerita.reference",
			version: 1,
			target: path,
		}),
	}));
}

/** 他の UI の要素や破損した要素は本文のまま表示し、検証できた参照だけを復元する。 */
export function restoreReferenceElements(
	text: string,
	elements: unknown,
): ComposerReference[] {
	if (!Array.isArray(elements)) {
		return [];
	}
	const bytes = Buffer.from(text, "utf8");
	const references = elements
		.flatMap((element) => {
			const reference = restoreElement(text, bytes, element);
			return reference ? [reference] : [];
		})
		.sort((a, b) => a.offset - b.offset);
	let end = 0;
	return references.filter((reference) => {
		if (reference.offset < end) {
			return false;
		}
		end = reference.offset + pathText(reference.path).length;
		return true;
	});
}

/** JSON の形式・UTF-8 境界・本文との一致を確認し、内部の文字列位置へ変換する。 */
function restoreElement(
	text: string,
	bytes: Buffer,
	element: unknown,
): ComposerReference | undefined {
	if (!isRecord(element) || typeof element.placeholder !== "string") {
		return;
	}
	if (!validByteRange(bytes, element.byteRange)) {
		return;
	}
	const target = elementTarget(element.placeholder);
	if (!target) {
		return;
	}
	const { start, end } = element.byteRange;
	const selected = bytes.subarray(start, end).toString("utf8");
	if (selected !== pathText(target)) {
		return;
	}
	const reference = {
		offset: bytes.subarray(0, start).toString("utf8").length,
		path: target,
	};
	return validReferences(text, [reference]) ? reference : undefined;
}

/** 他の UI のプレースホルダーや未知のバージョンは参照として解釈しない。 */
function elementTarget(placeholder: string) {
	try {
		const metadata: unknown = JSON.parse(placeholder);
		if (!isRecord(metadata)) {
			return;
		}
		if (metadata.type !== "nerita.reference" || metadata.version !== 1) {
			return;
		}
		return isComposerTarget(metadata.target) ? metadata.target : undefined;
	} catch {
		return undefined;
	}
}

/** 日本語や絵文字の途中を指す範囲や、本文の外を指す範囲を拒否する。 */
function validByteRange(
	bytes: Buffer,
	value: unknown,
): value is { start: number; end: number } {
	const result = byteRangeSchema.safeParse(value);
	if (!result.success) {
		return false;
	}
	const { start, end } = result.data;
	if (end <= start || end > bytes.length) {
		return false;
	}
	const startByte = bytes[start] ?? 0;
	const endByte = bytes[end] ?? 0;
	return (startByte & 0xc0) !== 0x80 && (endByte & 0xc0) !== 0x80;
}

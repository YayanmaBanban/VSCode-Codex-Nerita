// Phase 9移行前の比較用guard。互換性の基準として固定し、本番から参照しない。
// 追加の設定・使用量・ファイル参照を通信境界で検証する。
import { isRecord } from "../../../src/shared/validation";
import { validSkills } from "../../../src/shared/skills";

/** 入力欄専用の状態フィールドを検証する。 */
export function validComposerField(key: string, value: unknown): boolean {
	if (key === "skills") {
		return validSkills(value);
	}
	if (key === "quota") {
		return (
			value === null ||
			(Array.isArray(value) &&
				value.length > 0 &&
				value.every(
					(item: unknown) =>
						isRecord(item) &&
						typeof item.label === "string" &&
						typeof item.detail === "string" &&
						typeof item.remaining === "number" &&
						Number.isFinite(item.remaining) &&
						item.remaining >= 0 &&
						item.remaining <= 100,
				))
		);
	}
	if (key === "configPending" || key === "attachmentPending") {
		return typeof value === "boolean";
	}
	if (key === "usage") {
		return (
			value === null ||
			(isRecord(value) &&
				typeof value.used === "number" &&
				Number.isFinite(value.used) &&
				value.used >= 0 &&
				typeof value.size === "number" &&
				Number.isFinite(value.size) &&
				value.size > 0)
		);
	}
	if (key === "attachments") {
		return (
			Array.isArray(value) &&
			value.every(
				(file: unknown) =>
					isRecord(file) &&
					typeof file.id === "string" &&
					typeof file.name === "string" &&
					typeof file.uri === "string",
			)
		);
	}
	if (key === "configOptions") {
		return (
			Array.isArray(value) &&
			value.every(
				(option: unknown) =>
					isRecord(option) &&
					typeof option.id === "string" &&
					typeof option.name === "string" &&
					typeof option.currentValue === "string" &&
					(option.currentLabel === undefined ||
						typeof option.currentLabel === "string") &&
					Array.isArray(option.options) &&
					option.options.every(
						(choice: unknown) =>
							isRecord(choice) &&
							typeof choice.value === "string" &&
							typeof choice.name === "string",
					),
			)
		);
	}
	return false;
}

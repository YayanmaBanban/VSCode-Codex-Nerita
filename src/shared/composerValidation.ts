// 追加の設定・使用量・ファイル参照を通信境界で検証する。
import { isRecord } from "./validation";
import { validSkills } from "./skills";
import {
	ComposerConfigOptionsSchema,
	ComposerQuotaSchema,
} from "./composerSchemas";

/** 入力欄専用の状態フィールドを検証する。 */
export function validComposerField(key: string, value: unknown): boolean {
	if (key === "skills") {
		return validSkills(value);
	}
	if (key === "quota") {
		return ComposerQuotaSchema.safeParse(value).success;
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
		return ComposerConfigOptionsSchema.safeParse(value).success;
	}

	return false;
}

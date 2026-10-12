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
		return value === null || validUsage(value);
	}
	if (key === "attachments") {
		const matchesIsArray =
			Array.isArray(value) &&
			value.every((file: unknown) => {
				if (!isRecord(file)) {
					return false;
				}
				if (typeof file.id !== "string") {
					return false;
				}
				if (typeof file.name !== "string") {
					return false;
				}
				return typeof file.uri === "string";
			});
		return matchesIsArray;
	}
	if (key === "configOptions") {
		return ComposerConfigOptionsSchema.safeParse(value).success;
	}

	return false;
}

/** 使用量と上限が有効な有限数であることを確認する。 */
function validUsage(value: unknown): boolean {
	if (!isRecord(value)) {
		return false;
	}
	if (!(typeof value.used === "number")) {
		return false;
	}
	if (!Number.isFinite(value.used)) {
		return false;
	}

	if (!(value.used >= 0)) {
		return false;
	}
	if (!(typeof value.size === "number")) {
		return false;
	}
	if (!Number.isFinite(value.size)) {
		return false;
	}
	return value.size > 0;
}

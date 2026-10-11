// 承認の見出し・実行条件・詳細を、バックエンド共通の表示形式で定義する。
import { everyRecord, isId, isRecord } from "./validation";
import {
	commandPermissionKeySchema,
	type CommandPermissionKey,
} from "./commandPermission";

/** 値の表示方法を指定する承認項目。 */
export type PermissionField = {
	id: string;
	label: string;
	value: string;
	display: "text" | "code";
};

/** 承認操作とは独立した表示情報。詳細は開閉して確認する。 */
export type PermissionPresentation = {
	title: string;
	cwd?: string;
	command?: string;
	fields?: PermissionField[];
	details?: PermissionField[];
	commandPermission?: CommandPermissionKey;
};

/** 受信した表示情報の任意項目も、描画前に検証する。 */
export function isPermissionPresentation(
	value: unknown,
): value is PermissionPresentation {
	const validTitle = isRecord(value) && typeof value.title === "string";
	if (!(
		validTitle &&
		(value.commandPermission === undefined ||
			commandPermissionKeySchema.safeParse(value.commandPermission)
				.success)
	)) {
		return false;
	}
	return (
		["cwd", "command"].every(
			(key) => value[key] === undefined || typeof value[key] === "string",
		) &&
		["fields", "details"].every(
			(key) =>
				value[key] === undefined ||
				everyRecord(value[key], (field) => {
					const validField =
						isId(field.id) &&
						typeof field.label === "string" &&
						typeof field.value === "string";
					return (
						validField &&
						(field.display === "text" || field.display === "code")
					);
				}),
		)
	);
}

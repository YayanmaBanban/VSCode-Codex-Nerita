// 承認の見出し・実行条件・詳細を、バックエンド共通の表示形式で定義する。
import { everyRecord, isId, isRecord } from "./validation";

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
};

/** 受信した表示情報の任意項目も、描画前に検証する。 */
export function isPermissionPresentation(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.title === "string" &&
		["cwd", "command"].every(
			(key) => value[key] === undefined || typeof value[key] === "string",
		) &&
		["fields", "details"].every(
			(key) =>
				value[key] === undefined ||
				everyRecord(
					value[key],
					(field) =>
						isId(field.id) &&
						typeof field.label === "string" &&
						typeof field.value === "string" &&
						(field.display === "text" || field.display === "code"),
				),
		)
	);
}

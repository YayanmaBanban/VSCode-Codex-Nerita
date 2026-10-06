// 既存の平文認証は明示的に取り込み、保存先の読み戻しを検証してからメタデータを公開する。
import { open } from "node:fs/promises";
import type { CredentialStorageMode } from "@nerita/shared/credentials";
import type { PiCredentialVault } from "./PiCredentialStore";

/** 元ファイルの削除は行わず、移行前後の資格情報を検証する材料として保持する。 */
export async function preparePiAuthMigration(
	file: string,
	vault: PiCredentialVault,
	mode: CredentialStorageMode,
) {
	return vault.stageImport(await readLegacyAuth(file), mode);
}

/** 読取りは明示した移行操作に限定し、通常の SDK 起動では呼ばない。 */
export async function readLegacyAuth(file: string): Promise<unknown> {
	const handle = await open(file, "r");
	let records: unknown;
	try {
		if ((await handle.stat()).size > 64 * 1024) {
			throw new Error("認証ファイルが大きすぎます。");
		}
		try {
			records = JSON.parse(await handle.readFile("utf8"));
		} catch {
			throw new Error("既存の認証ファイルの形式が不正です。");
		}
	} finally {
		await handle.close();
	}
	return records;
}

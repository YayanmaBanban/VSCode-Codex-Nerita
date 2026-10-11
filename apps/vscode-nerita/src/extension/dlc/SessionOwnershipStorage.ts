// DLC の会話 ID をユーザー共通の Host 領域へ保存し、プロファイル変更後も手動利用を拒否する。
import { z } from "zod";
import { hostFiles } from "./HostFiles";
import { withDlcLock, DlcLockBusyError } from "./DlcLock";
import { setTimeout } from "node:timers/promises";
import type { SafeDlcFiles } from "./SafeDlcFiles";
import { DlcSessionOwnership } from "../session/DlcSessionOwnership";

const schema = z.array(z.string().min(1).max(8192));

export async function sessionOwnershipStorage(
	storageRoot: string,
): Promise<DlcSessionOwnership> {
	const files = await hostFiles(storageRoot, "session-ownership");
	await files.directory(".nerita/dlc");
	const file = ".nerita/dlc/sessions.json";
	const read = async () =>
		schema.parse(JSON.parse((await files.read(file)) ?? "[]"));
	const initial = await read();
	return new DlcSessionOwnership({
		read: () => initial,
		refresh: read,
		retryable: (error) => error instanceof DlcLockBusyError,
		write: (ids) =>
			withOwnershipLock(files, async () => {
				await files.write(file, [
					...new Set([...(await read()), ...schema.parse(ids)]),
				]);
			}),
	});
}

/** 全プロジェクト共通の追記を短時間直列化する。待機期限後も ID を保持し、次の保存で再試行する。 */
async function withOwnershipLock(
	files: SafeDlcFiles,
	operation: () => Promise<void>,
): Promise<void> {
	const deadline = Date.now() + 2000;
	while (true) {
		try {
			await withDlcLock(files, operation);
			return;
		} catch (error) {
			if (
				!(error instanceof DlcLockBusyError) ||
				Date.now() >= deadline
			) {
				throw error;
			}
			await setTimeout(25);
		}
	}
}

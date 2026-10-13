// ウィンドウをまたぐ保存を排他制御する。所有者が不明なロックは推測で解除しない。
import { randomUUID } from "node:crypto";
import {
	mkdir,
	readdir,
	rename,
	rmdir,
	unlink,
	lstat,
	readFile,
	realpath,
} from "node:fs/promises";
import { join } from "node:path";
import type { Stats } from "node:fs";
import { z } from "zod";
import {
	type SafeDlcFiles,
	missingFile,
	hasFileErrorCode,
} from "./SafeDlcFiles";

const ownerSchema = z.strictObject({
	token: z.uuid(),
	pid: z.number().int().positive(),
});

/** 取得前の一時競合だけを区別する。破損、書込み失敗、解放失敗は再試行しない。 */
export class DlcLockBusyError extends Error {}
/** プロセスの不在が明確な場合だけ終了済みと判定し、権限エラーを終了とみなさない。 */
function exited(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		return (
			error instanceof Error && "code" in error && error.code === "ESRCH"
		);
	}
}
/** 保存ロックを取得し、所有者の終了を確認できる古いロックだけを回収する。 */
async function acquire(
	files: SafeDlcFiles,
	target: string,
	lockPath: string,
): Promise<void> {
	const LockError = lockPath.endsWith(".controller")
		? Error
		: DlcLockBusyError;
	try {
		await mkdir(target);
	} catch (error) {
		if (!hasFileErrorCode(error, "EEXIST")) {
			throw error;
		}
		const text = await files.read(`${lockPath}/owner.json`);
		if (text === undefined) {
			throw new LockError(
				"DLC の保存ロックが未確定です。別の処理の終了を確認してください。",
				{ cause: error },
			);
		}
		const owner = ownerSchema.parse(JSON.parse(text));
		if (!exited(owner.pid)) {
			throw new LockError(
				lockPath.endsWith(".controller")
					? "別のウィンドウがこのプロジェクトの DLC を管理しています。管理元のウィンドウを使用してください。"
					: "別のウィンドウで DLC を保存しています。完了後に再読込みしてください。",
				{ cause: error },
			);
		}
		await rename(target, await files.path(`${lockPath}-${owner.token}`));
		await mkdir(target);
	}
}
/** 信頼失効後も、自分が取得した実体と所有者だけを確認してロックを解放する。 */
async function release(
	target: string,
	identity: Stats,
	token: string,
): Promise<void> {
	const current = await lstat(target);

	if (current.dev !== identity.dev) {
		throw new Error("DLC の保存ロックが差し替えられています。");
	}
	if (current.ino !== identity.ino) {
		throw new Error("DLC の保存ロックが差し替えられています。");
	}
	if (current.isSymbolicLink()) {
		throw new Error("DLC の保存ロックが差し替えられています。");
	}
	const matchesValue = (await realpath(target)) !== target;
	if (matchesValue) {
		throw new Error("DLC の保存ロックが差し替えられています。");
	}
	const ownerPath = join(target, "owner.json");
	const text = await readFile(ownerPath, "utf8").catch((error: unknown) => {
		if (missingFile(error)) {
			return undefined;
		}
		throw error;
	});
	if (text !== undefined) {
		if (ownerSchema.parse(JSON.parse(text)).token !== token) {
			throw new Error("DLC の保存ロックの所有者が差し替えられています。");
		}
		const ownerInfo = await lstat(ownerPath);
		if (ownerInfo.isSymbolicLink()) {
			throw new Error("DLC の保存ロックの所有者が差し替えられています。");
		}
		await unlink(ownerPath);
	}
	const matchesLength = (await readdir(target)).length > 0;
	if (matchesLength) {
		throw new Error("DLC の保存ロックに未知のファイルがあります。");
	}
	await rmdir(target);
}
/** 保存失敗は自動再送せず、呼び出し側が再読込みして期待版を照合する。 */
export async function withDlcLock<T>(
	files: SafeDlcFiles,
	operation: () => Promise<T>,
): Promise<T> {
	const lease = await acquireDlcLease(files, ".lock");
	try {
		return await operation();
	} finally {
		await lease();
	}
}

/** 管理元の稼働中も保存時と同じ実体照合で排他制御する。終了した所有者の記録は退避する。 */
export async function acquireDlcLease(
	files: SafeDlcFiles,
	name: ".lock" | ".controller",
): Promise<() => Promise<void>> {
	await files.directory(".nerita/dlc");
	const lockPath = `.nerita/dlc/${name}`;
	const target = await files.path(lockPath);
	await acquire(files, target, lockPath);
	const owner = { token: randomUUID(), pid: process.pid };
	const identity = await lstat(target);
	try {
		await files.write(`${lockPath}/owner.json`, owner);
	} catch (error) {
		await release(target, identity, owner.token);
		throw error;
	}
	return () => release(target, identity, owner.token);
}

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
import { type SafeDlcFiles, missingFile } from "./SafeDlcFiles";

const ownerSchema = z.strictObject({
	token: z.uuid(),
	pid: z.number().int().positive(),
});
const lockPath = ".nerita/dlc/.lock";
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
async function acquire(files: SafeDlcFiles, target: string): Promise<void> {
	try {
		await mkdir(target);
	} catch (error) {
		if (!(
			error instanceof Error &&
			"code" in error &&
			error.code === "EEXIST"
		)) {
			throw error;
		}
		const text = await files.read(`${lockPath}/owner.json`);
		if (text === undefined) {
			throw new Error(
				"DLC の保存ロックが未確定です。別の処理の終了を確認してください。",
				{ cause: error },
			);
		}
		const owner = ownerSchema.parse(JSON.parse(text));
		if (!exited(owner.pid)) {
			throw new Error(
				"別のウィンドウで DLC を保存しています。完了後に再読込みしてください。",
				{ cause: error },
			);
		}
		await rename(
			target,
			await files.path(`.nerita/dlc/.lock-${owner.token}`),
		);
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
	if (
		current.dev !== identity.dev ||
		current.ino !== identity.ino ||
		current.isSymbolicLink() ||
		(await realpath(target)) !== target
	) {
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
		if (
			ownerSchema.parse(JSON.parse(text)).token !== token ||
			(await lstat(ownerPath)).isSymbolicLink()
		) {
			throw new Error("DLC の保存ロックの所有者が差し替えられています。");
		}
		await unlink(ownerPath);
	}
	if ((await readdir(target)).length > 0) {
		throw new Error("DLC の保存ロックに未知のファイルがあります。");
	}
	await rmdir(target);
}
/** 保存失敗は自動再送せず、呼び出し側が再読込みして期待版を照合する。 */
export async function withDlcLock<T>(
	files: SafeDlcFiles,
	operation: () => Promise<T>,
): Promise<T> {
	await files.directory(".nerita/dlc");
	const target = await files.path(lockPath);
	await acquire(files, target);
	const owner = { token: randomUUID(), pid: process.pid };
	const identity = await lstat(target);
	try {
		await files.write(`${lockPath}/owner.json`, owner);
		return await operation();
	} finally {
		await release(target, identity, owner.token);
	}
}

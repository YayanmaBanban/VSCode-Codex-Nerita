// DLC のファイル操作をワークスペース内に閉じ込め、リンクと途中保存を検出する。
import { createHash, randomUUID } from "node:crypto";
import {
	lstat,
	mkdir,
	open,
	readFile,
	realpath,
	rename,
	unlink,
} from "node:fs/promises";
import type { Stats } from "node:fs";
import { resolve } from "node:path";
import { DlcPathSchema } from "@nerita/shared/dlc/contracts";
import { containsPath } from "../security/AgentAccessPolicy";

/** 比較対象の JSON は、保存する正規化済みの値から計算する。 */
export function jsonDigest(value: unknown): string {
	const text = JSON.stringify(value, (_key, item: unknown) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			return item;
		}
		return Object.fromEntries(
			Object.entries(item).sort(([a], [b]) => a.localeCompare(b, "en")),
		);
	});
	return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

/** ENOENT だけを不存在として扱い、権限不足や破損を初期値へ変換しない。 */
export function missingFile(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** 信頼とルートの照合は各操作の前後に行い、初期化中の取消しにも追随する。 */
export class SafeDlcFiles {
	constructor(
		readonly root: string,
		private readonly check: () => Promise<void>,
	) {}

	/** 存在する全構成要素を確認し、ワークスペース内のリンクも拒否する。 */
	async path(relativePath: string): Promise<string> {
		DlcPathSchema.parse(relativePath);
		await this.check();
		let target = this.root;
		for (const part of relativePath.split("/")) {
			target = resolve(target, part);
			try {
				const stat = await lstat(target);
				if (
					stat.isSymbolicLink() ||
					!containsPath(this.root, await realpath(target))
				) {
					throw new Error(
						`DLC のリンクを経由したアクセスはできません: ${relativePath}`,
					);
				}
			} catch (error) {
				if (!missingFile(error)) {
					throw error;
				}
			}
		}
		return target;
	}

	/** 既存内容を保持し、格納領域だけを順に作成する。 */
	async directory(relativePath: string): Promise<void> {
		DlcPathSchema.parse(relativePath);
		const parts = relativePath.split("/");
		for (let index = 1; index <= parts.length; index++) {
			const name = parts.slice(0, index).join("/");
			const target = await this.path(name);
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
				if (!(await lstat(target)).isDirectory()) {
					throw new Error(
						`DLC のディレクトリを作成できません: ${name}`,
						{ cause: error },
					);
				}
			}
			await this.path(name);
		}
	}

	/** 上限は解析前に確認し、巨大な管理ファイルを読み込まない。 */
	async read(
		relativePath: string,
		limit = 8 * 1024 * 1024,
	): Promise<string | undefined> {
		const target = await this.path(relativePath);
		let handle;
		try {
			const before = await lstat(target);
			handle = await open(target, "r");
			const stat = await handle.stat();
			assertReadable(before, stat, limit, relativePath);
			const text = await handle.readFile("utf8");
			if (Buffer.byteLength(text) > limit) {
				throw new Error(
					`DLC の読み取り上限を超えています: ${relativePath}`,
				);
			}
			await this.path(relativePath);
			const after = await lstat(target);
			assertUnchanged(stat, after);
			return text;
		} catch (error) {
			if (missingFile(error)) {
				return undefined;
			}
			throw error;
		} finally {
			await handle?.close();
		}
	}

	/** 同じディレクトリの一時ファイルを同期してから置換する。失敗時は旧内容を保持する。 */
	async write(relativePath: string, value: unknown): Promise<void> {
		const target = await this.path(relativePath);
		const temporary = `${relativePath}.${randomUUID()}.tmp`;
		const temporaryPath = await this.path(temporary);
		const text = `${JSON.stringify(value, null, 2)}\n`;
		const handle = await open(temporaryPath, "wx");
		try {
			try {
				await handle.writeFile(text, "utf8");
				await handle.sync();
			} finally {
				await handle.close();
			}
			if (
				JSON.stringify(
					JSON.parse(await readFile(temporaryPath, "utf8")),
				) !== JSON.stringify(value)
			) {
				throw new Error("DLC の一時ファイルを検証できません。");
			}
			await this.path(relativePath);
			await this.path(temporary);
			await rename(temporaryPath, target);
			await this.path(relativePath);
		} finally {
			await unlink(temporaryPath).catch((error: unknown) => {
				if (!missingFile(error)) {
					throw error;
				}
			});
		}
	}
}

function assertReadable(
	before: Stats,
	stat: Stats,
	limit: number,
	path: string,
): void {
	if (
		!stat.isFile() ||
		stat.size > limit ||
		before.dev !== stat.dev ||
		before.ino !== stat.ino ||
		stat.nlink !== 1
	) {
		throw new Error(`DLC のファイル形式または容量が不正です: ${path}`);
	}
}
function assertUnchanged(before: Stats, after: Stats): void {
	if (
		after.dev !== before.dev ||
		after.ino !== before.ino ||
		after.size !== before.size ||
		after.mtimeMs !== before.mtimeMs
	) {
		throw new Error("DLC の読み取り中にファイルが変更されました。");
	}
}

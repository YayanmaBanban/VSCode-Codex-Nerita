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
	return hasFileErrorCode(error, "ENOENT");
}

/** ファイル操作の例外が指定したシステムエラーか確認する。 */
export function hasFileErrorCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

/** 信頼とルートの照合は各操作の前後に行い、初期化中の取消しにも追随する。 */
export class SafeDlcFiles {
	/** アクセス対象を指定ルートへ限定し、各操作に利用側の信頼確認を適用する。 */
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

				if (stat.isSymbolicLink()) {
					throw new Error(
						`DLC のリンクを経由したアクセスはできません: ${relativePath}`,
					);
				}
				const resolvedTarget = await realpath(target);
				if (!containsPath(this.root, resolvedTarget)) {
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
				if (!hasFileErrorCode(error, "EEXIST")) {
					throw error;
				}
				const matchesIsDirectory = !(await lstat(target)).isDirectory();
				if (matchesIsDirectory) {
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
	async write(
		relativePath: string,
		value: unknown,
		limit?: number,
	): Promise<void> {
		const text = `${JSON.stringify(value, null, 2)}\n`;
		if (limit !== undefined && Buffer.byteLength(text, "utf8") > limit) {
			throw new Error(`DLC の保存上限を超えています: ${relativePath}`);
		}
		const target = await this.path(relativePath);
		const temporary = `${relativePath}.${randomUUID()}.tmp`;
		const temporaryPath = await this.path(temporary);
		const handle = await open(temporaryPath, "wx");
		try {
			try {
				await handle.writeFile(text, "utf8");
				await handle.sync();
			} finally {
				await handle.close();
			}
			const matchesStringify =
				JSON.stringify(
					JSON.parse(await readFile(temporaryPath, "utf8")),
				) !== JSON.stringify(value);
			if (matchesStringify) {
				throw new Error("DLC の一時ファイルの内容が、保存するデータと一致しません。");
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

/** 読み取り対象のファイル形式・容量・識別情報を照合し、複数リンクを持つファイルを拒否する。 */
function assertReadable(
	before: Stats,
	stat: Stats,
	limit: number,
	path: string,
): void {
	if (!stat.isFile() || stat.size > limit || before.dev !== stat.dev) {
		throw new Error(`DLC のファイルが通常のファイルではないか、読み取り上限を超えているか、検査時から保存先が変わっています: ${path}`);
	}
	if (before.ino !== stat.ino || stat.nlink !== 1) {
		throw new Error(`DLC のファイルが検査時から差し替えられているか、ハードリンク数が1ではありません: ${path}`);
	}
}
/** 読み取り前後のファイル識別情報・容量・更新時刻を比べ、途中の変更を拒否する。 */
function assertUnchanged(before: Stats, after: Stats): void {
	const matchesDev =
		after.dev !== before.dev ||
		after.ino !== before.ino ||
		after.size !== before.size;
	if (matchesDev) {
		throw new Error("DLC の読み取り中にファイルが変更されました。");
	}
	if (after.mtimeMs !== before.mtimeMs) {
		throw new Error("DLC の読み取り中にファイルが変更されました。");
	}
}

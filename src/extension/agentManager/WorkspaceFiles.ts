// 設定ファイルの参照範囲と内容の世代を確認し、同じワークスペースの保存を直列化する。
import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	readFile,
	realpath,
	stat,
	writeFile,
	rename,
	unlink,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalPath } from "../security/WorkspacePathPolicy";
import { containsPath } from "../security/AgentAccessPolicy";

const queues = new Map<string, Promise<unknown>>();
/** 複数パネルの保存でも、検査と書込みを同じ順序で行う。 */
export function serialized<T>(
	root: string,
	action: () => Promise<T>,
): Promise<T> {
	const task = (queues.get(root) ?? Promise.resolve())
		.catch(() => undefined)
		.then(action);
	queues.set(root, task);
	void task
		.finally(() => {
			if (queues.get(root) === task) {
				queues.delete(root);
			}
		})
		.catch(() => undefined);
	return task;
}

/** シンボリックリンクで別の設定を更新することを防ぐ。 */
export async function workspaceFile(root: string, relative: string) {
	const base = await realpath(root);
	const target = resolve(base, relative);
	if (
		!containsPath(base, target) ||
		(await canonicalPath(target, base)) !== target
	) {
		throw new Error("設定ファイルのリンク先または保存先が不正です。");
	}
	return target;
}

/** 不在と不正なファイルを区別し、過大な設定を読み込まない。 */
export async function readWorkspaceFile(
	root: string,
	relative: string,
): Promise<string | undefined> {
	const file = await workspaceFile(root, relative);
	try {
		const info = await stat(file);
		if (!info.isFile() || info.size > 262144) {
			throw new Error(`設定ファイルのサイズが不正です: ${relative}`);
		}
		return await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}

/** 最後の照合後に一時ファイルを置換し、途中までの JSON を残さない。 */
export async function writeWorkspaceFile(
	root: string,
	relative: string,
	expected: string | undefined,
	text: string,
) {
	if ((await readWorkspaceFile(root, relative)) !== expected) {
		throw new Error("別の編集が保存されています。再読み込みしてください。");
	}
	const target = await workspaceFile(root, relative);
	await mkdir(dirname(target), { recursive: true });
	await workspaceFile(root, relative);
	const temp = `${target}.${randomUUID()}.tmp`;
	try {
		await writeFile(temp, text, { flag: "wx" });
		if ((await readWorkspaceFile(root, relative)) !== expected) {
			throw new Error(
				"保存中に設定が変更されました。再読み込みしてください。",
			);
		}
		await rename(temp, target);
	} finally {
		await unlink(temp).catch(() => undefined);
	}
}

/** ファイル名も含めることで追加・削除・同名定義の変更を検出する。 */
export function generation(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// Git の共通管理ディレクトリを識別し、チェックアウト外にプロジェクトの実行状態を置く。
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { containsPath } from "../security/AgentAccessPolicy";
import { trustKey } from "../security/trust/WorkspaceTrustStore";
import { SafeDlcFiles } from "./SafeDlcFiles";
import { acquireDlcLease } from "./DlcLock";
import { AuthorityRecordSchema, type IntentAuthority } from "./IntentAuthority";

const execute = promisify(execFile);
const authoritySchema = z.record(z.string(), AuthorityRecordSchema);

/** Worktree ごとの .git ファイルや大文字・小文字の差があっても、同じプロジェクトとして識別する。 */
export async function projectIdentity(root: string, signal?: AbortSignal) {
	const actual = await realpath(root);
	const { stdout } = await execute(
		"git",
		[
			"-C",
			actual,
			"rev-parse",
			"--path-format=absolute",
			"--git-common-dir",
		],
		{
			windowsHide: true,
			timeout: 10000,
			...(signal ? { signal } : {}),
		},
	);
	const commonDirectory = await realpath(stdout.trim());
	const identity = await stat(commonDirectory);
	const id = createHash("sha256")
		.update(
			JSON.stringify({
				path: trustKey(commonDirectory),
				dev: identity.dev,
				ino: identity.ino,
				birthtimeMs: identity.birthtimeMs,
			}),
		)
		.digest("hex");
	return { id, root: actual, commonDirectory };
}

/** 永続状態とその検証根拠を同じ管理元が所有する。Git 内の状態は読み込まない。 */
export class ProjectStorage {
	private constructor(
		readonly id: string,
		readonly files: SafeDlcFiles,
		readonly authority: IntentAuthority,
		private release: () => Promise<void>,
	) {}

	static async open(
		root: string,
		storageRoot: string,
		check: () => Promise<void>,
	): Promise<ProjectStorage> {
		const project = await projectIdentity(root);
		const target = join(storageRoot, "projects", project.id);
		await mkdir(target, { recursive: true });
		const actual = await realpath(target);
		if (
			containsPath(project.root, actual) ||
			containsPath(actual, project.root)
		) {
			throw new Error(
				"実行状態の保存先はチェックアウトの外にしてください。",
			);
		}
		const identity = await stat(actual);
		const files = new SafeDlcFiles(actual, async () => {
			await check();
			const current = await stat(actual);
			if (
				trustKey(await realpath(target)) !== trustKey(actual) ||
				current.dev !== identity.dev ||
				current.ino !== identity.ino
			) {
				throw new Error("実行状態の保存先が差し替えられています。");
			}
			if (current.birthtimeMs !== identity.birthtimeMs) {
				throw new Error("実行状態の保存先が差し替えられています。");
			}
		});
		const release = await acquireDlcLease(files, ".controller");
		try {
			const text = await files.read(".nerita/dlc/authority.json");
			let records =
				text === undefined
					? {}
					: authoritySchema.parse(JSON.parse(text));
			const authority: IntentAuthority = {
				read: (key) => records[key],
				write: async (key, value) => {
					const next = authoritySchema.parse({
						...records,
						[key]: value,
					});
					await files.write(".nerita/dlc/authority.json", next);
					records = next;
				},
			};
			return new ProjectStorage(project.id, files, authority, release);
		} catch (error) {
			await release();
			throw error;
		}
	}

	/** 実行の停止と保存の完了後に呼ぶ。信頼の取消し後も自分のロックだけ解放する。 */
	dispose(): Promise<void> {
		return this.release();
	}
}

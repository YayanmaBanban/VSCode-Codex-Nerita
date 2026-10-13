// main の管理画面から Git worktree を作成・照合・削除し、任意パスの指定は受け付けない。
import { execFile } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, realpath, lstat, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { containsPath } from "../security/AgentAccessPolicy";
import { trustKey } from "../security/trust/WorkspaceTrustStore";
import { projectIdentity } from "./ProjectStorage";

const execute = promisify(execFile);
/** 選択できる Worktree の情報。削除の可否は表示情報だけで決めず、操作時にも Host で検証する。 */
export type WorktreeTarget = {
	id: string;
	root: string;
	name: string;
	branch: string | null;
	main: boolean;
	removable: boolean;
};

/** Git の登録情報と実体を毎回照合し、Worktree の消失や別リポジトリへの差替えを拒否する。 */
export class WorktreeManager {
	/** Git の操作元と Nerita の Worktree 保存先を分けて固定する。 */
	constructor(
		private root: string,
		private storageRoot: string,
	) {}
	/** Git の操作元を登録ルートへ固定し、取消しと時間・出力の上限を適用する。 */
	private async git(args: string[], signal?: AbortSignal): Promise<string> {
		return (
			await execute("git", ["-C", this.root, ...args], {
				windowsHide: true,
				timeout: 30000,
				maxBuffer: 8 * 1024 * 1024,
				...(signal ? { signal } : {}),
			})
		).stdout;
	}
	/** Git の登録とリポジトリの実体を照合し、Nerita の管理領域にある未ロックの子だけを削除候補にする。 */
	async list(signal?: AbortSignal): Promise<WorktreeTarget[]> {
		const project = await projectIdentity(this.root, signal);
		const output = await this.git(
			["worktree", "list", "--porcelain", "-z"],
			signal,
		);
		const groups = output.split("\0\0").filter((item) => item !== "");
		const result: WorktreeTarget[] = [];
		for (const [index, group] of groups.entries()) {
			const fields = group.split("\0");
			const directory = fields
				.find((field) => field.startsWith("worktree "))
				?.slice(9);

			if (directory === undefined) {
				continue;
			}
			if (fields.some((field) => field.startsWith("prunable"))) {
				continue;
			}
			const root = await realpath(directory);
			const matchesId =
				(await projectIdentity(root, signal)).id !== project.id;
			if (matchesId) {
				throw new Error(
					"Worktree のリポジトリが差し替えられています。",
				);
			}
			const gitDir = await this.gitDirectory(root, signal);
			await this.validateRegistration(
				root,
				gitDir,
				project.commonDirectory,
				index === 0,
			);
			const id = createHash("sha256")
				.update(
					JSON.stringify([
						trustKey(root),
						trustKey(await realpath(gitDir)),
					]),
				)
				.digest("hex");
			const managed = join(this.storageRoot, "worktrees", project.id);
			result.push({
				id,
				root,
				name: basename(root),
				branch:
					fields
						.find((field) => field.startsWith("branch "))
						?.slice(7)
						.replace(/^refs\/heads\//u, "") ?? null,
				main: index === 0,
				removable:
					index !== 0 &&
					containsPath(managed, root) &&
					!fields.some((field) => field.startsWith("locked")),
			});
		}
		return result;
	}
	/** 追加した Worktree の個別 Git 管理情報が、選択した Worktree の .git ファイルを指すことを確認する。 */
	private async validateRegistration(
		root: string,
		gitDir: string,
		commonDirectory: string,
		main: boolean,
	): Promise<void> {
		if (main) {
			const matchesTrustKey =
				trustKey(await realpath(gitDir)) !== trustKey(commonDirectory);
			if (matchesTrustKey) {
				throw new Error(
					"main の Git 登録が別の Worktree を指しています。",
				);
			}
			return;
		}
		const backlink = await readFile(join(gitDir, "gitdir"), "utf8");
		const gitFile = await realpath(resolve(gitDir, backlink.trim()));
		const matchesTrustKey2 =
			trustKey(gitFile) !== trustKey(join(root, ".git")) ||
			trustKey(await realpath(dirname(gitFile))) !== trustKey(root);
		if (matchesTrustKey2) {
			throw new Error(
				"Worktree の個別 Git 登録が別の作業ディレクトリを指しています。",
			);
		}
	}
	/** 各作業ルートの実体 Git 領域を取得し、Worktree の登録確認に使う。 */
	private async gitDirectory(
		root: string,
		signal?: AbortSignal,
	): Promise<string> {
		return (
			await execute(
				"git",
				[
					"-C",
					root,
					"rev-parse",
					"--path-format=absolute",
					"--git-dir",
				],
				{
					windowsHide: true,
					timeout: 10000,
					...(signal ? { signal } : {}),
				},
			)
		).stdout.trim();
	}
	/** 選択 ID を最新の検証済み一覧から解決し、削除された対象を実行先へ使わない。 */
	async target(id: string, signal?: AbortSignal): Promise<WorktreeTarget> {
		const target = (await this.list(signal)).find((item) => item.id === id);
		if (!target) {
			throw new Error(
				"選択した Worktree は存在しません。実行先を再確認してください。",
			);
		}
		return target;
	}
	/** main の HEAD からブランチに属さない Worktree を作る。未コミットの変更は転送しない。 */
	async create(signal?: AbortSignal): Promise<WorktreeTarget> {
		const project = await projectIdentity(this.root, signal);
		const targets = await this.list(signal);
		const matchesSome = !targets.some(
			(target) =>
				target.main && trustKey(target.root) === trustKey(project.root),
		);
		if (matchesSome) {
			throw new Error(
				"Worktree の作成は main の管理画面から実行してください。",
			);
		}
		const parent = join(this.storageRoot, "worktrees", project.id);
		await mkdir(parent, { recursive: true });
		const matchesTrustKey3 =
			trustKey(await realpath(parent)) !== trustKey(parent) ||
			containsPath(project.root, parent);
		if (matchesTrustKey3) {
			throw new Error(
				"Worktree の作成先が作業ディレクトリ内にあるか、リンクを経由しています。",
			);
		}
		const directory = join(parent, `work-${randomUUID().slice(0, 8)}`);
		await this.git(
			["worktree", "add", "--detach", directory, "HEAD"],
			signal,
		);
		const created = (await this.list(signal)).find(
			(target) => trustKey(target.root) === trustKey(directory),
		);
		if (!created) {
			throw new Error(
				"作成した Worktree を確認できません。作業ディレクトリを保持して再確認してください。",
			);
		}
		return created;
	}
	/** Git の登録情報・リンク・未コミット・未追跡・除外対象のファイルを確認し、強制削除は行わない。実行中の削除は呼び出し側で防ぐ。 */
	async remove(id: string, signal?: AbortSignal): Promise<void> {
		const target = await this.target(id, signal);

		if (!target.removable) {
			throw new Error("この Worktree は安全な削除の対象ではありません。");
		}
		const targetInfo = await lstat(target.root);
		if (targetInfo.isSymbolicLink()) {
			throw new Error("この Worktree は安全な削除の対象ではありません。");
		}
		const status = await execute(
			"git",
			[
				"-C",
				target.root,
				"status",
				"--porcelain",
				"-z",
				"--untracked-files=all",
				"--ignored=matching",
			],
			{
				windowsHide: true,
				timeout: 10000,
				...(signal ? { signal } : {}),
			},
		);
		if (status.stdout !== "") {
			throw new Error(
				"未コミット・未追跡・Git の除外対象のファイルがあります。Worktree を保持しています。",
			);
		}
		const confirmed = await this.target(id, signal);
		if (confirmed.root !== target.root) {
			throw new Error("削除対象が変更されています。");
		}
		await this.git(["worktree", "remove", "--", target.root], signal);
	}
}

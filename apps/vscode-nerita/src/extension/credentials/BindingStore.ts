// ワークスペース内には検証済みの Binding メタデータだけを書き、既存の設定と除外規則を保持する。
import { fsErrorCode } from "../runtime/FsError";
import {
	lstat,
	mkdir,
	open,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
	credentialBindingsSchema,
	type CredentialBinding,
} from "@nerita/shared/credentials";
import { throwCredentialError } from "./CredentialErrors";

/** `root` は Host が確定したワークスペース。リンク経由でワークスペース外へ保存しない。 */
export class BindingStore {
	private pending = Promise.resolve();
	/** 資格情報の参照設定はこのルートの設定ファイルに限定する。 */
	constructor(readonly root: string) {}
	/** 保存先の実体がルート直下であることを確認し、リンクによるワークスペース外への逸脱を拒否する。 */
	private async directory(create = false) {
		const root = await realpath(this.root);
		const directory = join(root, ".nerita");
		if (create) {
			await mkdir(directory, { recursive: true });
		}
		try {
			const directoryInfo = await lstat(directory);
			if (directoryInfo.isSymbolicLink()) {
				throw new Error(
					"Binding の保存先にシンボリックリンクは使用できません。",
				);
			}
			const actualParent = dirname(await realpath(directory));
			if (actualParent !== root) {
				throw new Error(
					"Binding の保存先である .nerita フォルダの実際の配置先が、ワークスペース直下ではありません。",
				);
			}
		} catch (error) {
			if (fsErrorCode(error) !== "ENOENT" || create) {
				throw error;
			}
		}
		return directory;
	}
	/** 未作成の設定だけを空として扱い、リンク・上限超過・形式の破損は読取り失敗として通知する。 */
	async read(): Promise<CredentialBinding[]> {
		try {
			const path = join(await this.directory(), "bindings.json");
			const matchesIsSymbolicLink = (await lstat(path)).isSymbolicLink();
			if (matchesIsSymbolicLink) {
				throw new Error("Binding へのリンクは使用できません。");
			}
			const file = await open(path, "r");
			try {
				const matchesSize = (await file.stat()).size > 256 * 1024;
				if (matchesSize) {
					throw new Error();
				}
				return credentialBindingsSchema.parse(
					JSON.parse(await file.readFile("utf8")),
				).bindings;
			} finally {
				await file.close();
			}
		} catch (error) {
			if (fsErrorCode(error) === "ENOENT") {
				return [];
			}
			return throwCredentialError(
				"Binding を読み込めません。形式と保存先を確認してください。",
				error,
			);
		}
	}
	/** 並行する編集を直列化し、失敗時は前のファイルを保持する。 */
	update(
		change: (bindings: CredentialBinding[]) => CredentialBinding[],
	): Promise<void> {
		/** 参照設定の更新と除外設定を同じ待機列で行い、保存先を再確認してから一時ファイルを置き換える。 */
		const commitBindings = async () => {
			const data = credentialBindingsSchema.parse({
				version: 1,
				bindings: change(await this.read()),
			});
			const directory = await this.directory(true);
			const ignore = join(directory, ".gitignore");
			try {
				await writeFile(ignore, "/bindings.json\n", { flag: "wx" });
			} catch (error) {
				if (fsErrorCode(error) !== "EEXIST") {
					throw error;
				}
				const matchesIsSymbolicLink = (
					await lstat(ignore)
				).isSymbolicLink();
				if (matchesIsSymbolicLink) {
					throwCredentialError(
						"除外設定へのリンクは使用できません。",
						error,
					);
				}
				const text = await readFile(ignore, "utf8");
				if (!text.split(/\r?\n/).includes("/bindings.json")) {
					await writeFile(
						ignore,
						`${text}${text.endsWith("\n") ? "" : "\n"}/bindings.json\n`,
					);
				}
			}
			const temporary = join(directory, `.bindings-${randomUUID()}.tmp`);
			try {
				await writeFile(
					temporary,
					`${JSON.stringify(data, null, 2)}\n`,
					{ flag: "wx" },
				);
				await this.directory();
				await rename(temporary, join(directory, "bindings.json"));
			} finally {
				await rm(temporary, { force: true });
			}
		};
		const result = this.pending.then(commitBindings);
		this.pending = result.catch(() => {});
		return result;
	}
}

// ワークスペース内には検証済みの Binding メタデータだけを書き、既存の設定と除外規則を保持する。
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
	constructor(readonly root: string) {}
	private async directory(create = false) {
		const root = await realpath(this.root);
		const directory = join(root, ".nerita");
		if (create) {
			await mkdir(directory, { recursive: true });
		}
		try {
			if (
				(await lstat(directory)).isSymbolicLink() ||
				dirname(await realpath(directory)) !== root
			) {
				throw new Error("Binding の保存先が Workspace 外です。");
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT" || create) {
				throw error;
			}
		}
		return directory;
	}
	async read(): Promise<CredentialBinding[]> {
		try {
			const path = join(await this.directory(), "bindings.json");
			if ((await lstat(path)).isSymbolicLink()) {
				throw new Error("Binding へのリンクは使用できません。");
			}
			const file = await open(path, "r");
			try {
				if ((await file.stat()).size > 256 * 1024) {
					throw new Error();
				}
				return credentialBindingsSchema.parse(
					JSON.parse(await file.readFile("utf8")),
				).bindings;
			} finally {
				await file.close();
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
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
		const result = this.pending.then(async () => {
			const data = credentialBindingsSchema.parse({
				version: 1,
				bindings: change(await this.read()),
			});
			const directory = await this.directory(true);
			const ignore = join(directory, ".gitignore");
			try {
				await writeFile(ignore, "/bindings.json\n", { flag: "wx" });
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
					throw error;
				}
				if ((await lstat(ignore)).isSymbolicLink()) {
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
		});
		this.pending = result.catch(() => {});
		return result;
	}
}

// 指定された保存先のTOMLを読み、設定ファイルを優先してプリセットを保存する。
import { readFile, mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { parse, stringify } from "smol-toml";
import {
	isPersonalityPreset,
	type PersonalitySettings,
	type PersonalityScope,
	type PersonalityMessage,
} from "../../../../shared/personality";

/** 存在しないファイルだけを空設定として扱い、破損や権限エラーは通知する。 */
async function readToml(path: string) {
	try {
		return parse(await readFile(path, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return {};
		}
		throw error;
	}
}

/** 同じ接続の保存操作を直列化し、途中の書き込みを読ませない。 */
export class PersonalityStore {
	private tail: Promise<unknown> = Promise.resolve();
	/** プリセットは固定のホーム配下、Codex設定はCODEX_HOMEにも追従する。 */
	constructor(
		private readonly cwd: string,
		private readonly home = homedir(),
		private readonly configHome = process.env.CODEX_HOME ||
			join(home, ".codex"),
	) {}
	/** 保存先をUI入力に依存せず決定する。 */
	private presetPath(scope: "global" | "workspace") {
		return join(
			scope === "global" ? this.home : this.cwd,
			".codex",
			"nerita",
			"preset.toml",
		);
	}
	/** config.tomlに値があるペインはプリセットより優先して固定する。 */
	private async readScope(
		scope: "global" | "workspace",
	): Promise<PersonalityScope> {
		const [data, config] = await Promise.all([
			readToml(this.presetPath(scope)),
			readToml(
				join(
					scope === "global"
						? this.configHome
						: join(this.cwd, ".codex"),
					"config.toml",
				),
			),
		]);
		const presets = data.presets ?? [];
		if (
			!Array.isArray(presets) ||
			!presets.every(isPersonalityPreset) ||
			new Set(presets.map((p) => p.name)).size !== presets.length
		) {
			throw new Error(
				"preset.toml の [[presets]] に重複しない名前と本文を指定してください。",
			);
		}
		if (
			config.developer_instructions !== undefined &&
			typeof config.developer_instructions !== "string"
		) {
			throw new Error(
				"developer_instructions は文字列で指定してください。",
			);
		}
		const selected = data.selected ?? presets[0]?.name ?? "";
		if (
			typeof selected !== "string" ||
			(selected !== "" && !presets.some((p) => p.name === selected))
		) {
			throw new Error(
				"preset.toml の selected がプリセット名と一致しません。",
			);
		}
		return {
			presets,
			selected,
			configuredText:
				typeof config.developer_instructions === "string"
					? config.developer_instructions
					: null,
		};
	}
	/** 保存の完了後に両ペインの最新内容を取得する。 */
	async read(): Promise<PersonalitySettings> {
		await this.tail;
		const [global, workspace] = await Promise.all([
			this.readScope("global"),
			this.readScope("workspace"),
		]);
		return { global, workspace };
	}
	/** 更新は既存名、保存は新しい名前を追加し、選択も同じファイルへ保存する。 */
	async change(
		message: Exclude<PersonalityMessage, { type: "personality/read" }>,
	): Promise<PersonalitySettings> {
		const operation = this.tail.then(async () => {
			const scope = await this.readScope(message.scope);
			if (scope.configuredText !== null) {
				throw new Error(
					"config.toml の指示はこのパネルから変更できません。",
				);
			}
			if (message.type === "personality/save") {
				const index = scope.presets.findIndex(
					(p) => p.name === message.name,
				);
				if (index >= 0 && message.originalName !== message.name) {
					throw new Error(
						"同名のプリセットが存在します。別の名前で保存してください。",
					);
				}
				if (!isPersonalityPreset(message)) {
					throw new Error("プリセット名と本文を確認してください。");
				}
				const preset = { name: message.name, text: message.text };
				if (index < 0) {
					scope.presets.push(preset);
				} else {
					scope.presets[index] = preset;
				}
			} else if (
				message.name !== "" &&
				!scope.presets.some((p) => p.name === message.name)
			) {
				throw new Error("プリセットが見つかりません。");
			}
			const path = this.presetPath(message.scope);
			const data = await readToml(path);
			await mkdir(dirname(path), { recursive: true });
			const temporary = `${path}.${randomUUID()}.tmp`;
			try {
				await writeFile(
					temporary,
					stringify({
						...data,
						selected: message.name,
						presets: scope.presets,
					}),
					"utf8",
				);
				await rename(temporary, path);
			} finally {
				await unlink(temporary).catch(() => undefined);
			}
		});
		this.tail = operation.catch(() => undefined);
		await operation;
		return this.read();
	}
}

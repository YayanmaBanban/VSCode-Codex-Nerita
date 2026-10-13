// モデル設定を項目ごとに重ね、既存のワークスペース指定を優先して保存する。
import { homedir } from "node:os";
import { parse } from "smol-toml";
import { z } from "zod";
import {
	readWorkspaceFile,
	serialized,
	writeWorkspaceFile,
	workspaceFile,
} from "../agentManager/WorkspaceFiles";
import { editModelConfig } from "./editModelConfig";

const section = z
	.object({
		model: z.string().min(1).optional(),
		provider: z.string().min(1).optional(),
		reasoning: z.string().optional(),
	})
	.loose();
const schema = z
	.object({ pi: section.optional(), codex: section.optional() })
	.loose();
/** モデル・取得元・推論の選択状態。省略された項目は既定値へ委ねる。 */
type Selection = {
	model?: string | undefined;
	provider?: string | undefined;
	reasoning?: string | undefined;
};
const relative = ".nerita/config.toml";

/** 対象ルートを固定し、他の会話や設定ファイルの編集を上書きしない。 */
export class ModelConfig {
	/** 設定の保存先をプロジェクトとユーザーに分け、書込みの制約は利用側の確認関数を使う。 */
	constructor(
		private readonly root: string,
		private readonly globalRoot = homedir(),
		private readonly assertWritable: (file: string) => void = () => {},
	) {}
	/** 設定本文と保存先を同じルートで解決し、内容をスキーマで検証してから編集処理へ渡す。 */
	private async load(root: string) {
		const text = await readWorkspaceFile(root, relative);
		return {
			text,
			file: await workspaceFile(root, relative),
			data: schema.parse(parse(text ?? "")),
		};
	}
	/** 未指定の項目だけ Global から引き継ぐ。 */
	async read(backend: "pi" | "codex"): Promise<Selection> {
		const [global, workspace] = await Promise.all([
			this.load(this.globalRoot),
			this.load(this.root),
		]);
		return { ...global.data[backend], ...workspace.data[backend] };
	}
	/** UI の変更は、各項目を既に指定しているスコープへ保存する。 */
	write(backend: "pi" | "codex", selection: Selection): Promise<void> {
		/** 設定の保存を直列化し、既存の指定範囲を保ちながらユーザーとプロジェクトの保存先を再確認する。 */
		const saveModelSelection = async () => {
			const [global, workspace] = await Promise.all([
				this.load(this.globalRoot),
				this.load(this.root),
			]);
			const local: Record<string, string> = {};
			const shared: Record<string, string> = {};
			for (const key of ["provider", "model", "reasoning"] as const) {
				const value = selection[key];
				if (value !== undefined) {
					(workspace.file !== global.file &&
					workspace.data[backend]?.[key] !== undefined
						? local
						: shared)[key] = value;
				}
			}
			const writes = [
				{ root: this.globalRoot, source: global, values: shared },
				{ root: this.root, source: workspace, values: local },
			]
				.filter((item) => Object.keys(item.values).length > 0)
				.map((item) => ({
					...item,
					text: editModelConfig(
						item.source.text ?? "",
						backend,
						item.values,
					),
				}));
			for (const item of writes) {
				this.assertWritable(item.source.file);
			}
			for (const item of writes) {
				this.assertWritable(item.source.file);
				await writeWorkspaceFile(
					item.root,
					relative,
					item.source.text,
					item.text,
				);
			}
		};
		return serialized(this.globalRoot, saveModelSelection);
	}
}

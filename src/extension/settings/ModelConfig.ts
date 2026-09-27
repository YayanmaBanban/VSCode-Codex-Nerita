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
	.passthrough();
const schema = z
	.object({ pi: section.optional(), codex: section.optional() })
	.passthrough();
type Selection = {
	model?: string | undefined;
	provider?: string | undefined;
	reasoning?: string | undefined;
};
const relative = ".nerita/config.toml";

/** 対象ルートを固定し、他の会話や設定ファイルの編集を上書きしない。 */
export class ModelConfig {
	constructor(
		private readonly root: string,
		private readonly globalRoot = homedir(),
		private readonly assertWritable: (file: string) => void = () => {},
	) {}
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
		return serialized(this.globalRoot, async () => {
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
				.filter((item) => Object.keys(item.values).length)
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
		});
	}
}

// `.codex/agents` 直下の TOML を読み、定義・モデル・承認設定を編集用の状態へ変換する。
import { readdir } from "node:fs/promises";
import { parse } from "smol-toml";
import { z } from "zod";
import {
	codexReasoningSchema,
	agentEditSchema,
} from "@nerita/shared/agentManager/config";
import type { ManagedAgent } from "@nerita/shared/agentManager/messages";
import { readWorkspaceFile, workspaceFile } from "./WorkspaceFiles";

const definitionSchema = z.object({
	name: z.string().min(1),
	description: z.string(),
	developer_instructions: z.string(),
	model: z.string().optional(),
	model_reasoning_effort: z.string().optional(),
	sandbox_mode: agentEditSchema.shape.sandboxMode,
	approvals_reviewer: agentEditSchema.shape.approvalsReviewer,
	approval_policy: agentEditSchema.shape.approvalPolicy,
});
/** ワークスペースの Agent だけを編集対象として返す。 */
export async function codexAgentFiles(root: string) {
	const directory = await workspaceFile(root, ".codex/agents");
	let names: string[];
	try {
		names = (await readdir(directory))
			.filter((name) => name.endsWith(".toml"))
			.sort();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { agents: [], files: {}, errors: [] };
		}
		throw error;
	}
	if (names.length > 128) {
		throw new Error("Codex Agent 定義が128件を超えています。");
	}
	const files: Record<string, string> = {};
	const agents: ManagedAgent[] = [];
	const errors: string[] = [];
	for (const name of names) {
		const file = `.codex/agents/${name}`;
		try {
			const text = await readWorkspaceFile(root, file);
			if (text === undefined) {
				throw new Error("定義が削除されました。");
			}
			files[file] = text;
			const data = definitionSchema.parse(parse(text));
			agents.push(agentView(file, data));
		} catch (error) {
			errors.push(`${file}: ${String(error)}`);
		}
	}
	markDuplicates(agents);
	return { agents, files, errors };
}

/** 未対応の推論指定がある定義を編集不可にし、保存による削除を防ぐ。 */
function agentView(
	file: string,
	data: z.infer<typeof definitionSchema>,
): ManagedAgent {
	const reasoning = codexReasoningSchema.safeParse(
		data.model_reasoning_effort,
	);
	return {
		id: file,
		definitionPath: file,
		backend: "codex",
		name: data.name,
		description: data.description,
		source: "project",
		aliases: [],
		tools: [],
		editable:
			data.model_reasoning_effort === undefined || reasoning.success,
		definitionModel: data.model,
		definitionThinking: data.model_reasoning_effort,
		edit: {
			definition: {
				name: data.name,
				description: data.description,
				prompt: data.developer_instructions,
			},
			sandboxMode: data.sandbox_mode,
			approvalsReviewer: data.approvals_reviewer,
			approvalPolicy: data.approval_policy,
			model: data.model,
			reasoningEffort: reasoning.success ? reasoning.data : undefined,
		},
		unavailableReason:
			data.model_reasoning_effort !== undefined && !reasoning.success
				? "未対応の推論指定です。TOML を直接確認してください。"
				: undefined,
	};
}

/** ファイル名ではなく標準の `name` を識別子として重複を検出する。 */
function markDuplicates(agents: ManagedAgent[]) {
	const counts = new Map<string, number>();
	for (const agent of agents) {
		counts.set(agent.name, (counts.get(agent.name) ?? 0) + 1);
	}
	for (const agent of agents) {
		if (counts.get(agent.name)! > 1) {
			agent.editable = false;
			agent.unavailableReason = "同名の Agent 定義が複数あります。";
		}
	}
}

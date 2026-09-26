// ワークフローの子会話を保持し、継続と完了時点の複製を通常のガードへ接続する。
import type {
	Workflow,
	WorkflowStep,
} from "../../../../shared/workflows/definition";
import type { PiChildRuntimes } from "../PiChildRuntimes";
import type { PiAgentViews } from "../PiAgentViews";
import type { PiJobs } from "../PiJobs";
import type { PiSubagentDefinition } from "../PiSubagentDefinitions";
import type { PiModelSelection, PiRuntimeSession } from "../PiRuntime";
import type { AgentAccessPolicy } from "../../../security/AgentAccessPolicy";
import {
	approveToolCall,
	type ToolAuthorizer,
} from "../../../security/ApprovalGuard";
import { consumeApprovedToolCall } from "../../../security/ApprovedToolCall";
import { forkContext, type PiForkMessage } from "../PiForkContext";
import { agentModel, selectAgent, supportedTools } from "../PiSubagentTool";
import type { WorkflowResult } from "./PiWorkflowEngine";
import { promptWorkflowChild } from "./PiWorkflowPrompt";

/** 継続中も承認先は親のまま、表示するジョブだけを切り替える。 */
type Retained = {
	child: PiRuntimeSession;
	approval: { id: string; agent: string; task: string };
	latest: string;
};
/** Fork は後続の resume によって変化しない完了時点の会話を使う。 */
type Completed = {
	retained: Retained;
	messages: PiForkMessage[];
	result: WorkflowResult;
};
/** 起動前に解決した Agent とモデルを実行中に変更しない。 */
type Plan = {
	step: WorkflowStep;
	definition: PiSubagentDefinition;
	model: PiModelSelection;
};

/** 全子を同じ親ジョブの寿命で保持し、終了時には成功した子も閉じる。 */
export class PiWorkflowChildren {
	private plans = new Map<string, Plan>();
	private completed = new Map<string, Completed>();
	private started = new Set<string>();
	private pending = new Set<Promise<WorkflowResult>>();
	private retained = new Set<Retained>();
	constructor(
		workflow: Workflow,
		definitions: PiSubagentDefinition[],
		parentModel: { provider: string; id: string } | undefined,
		private children: PiChildRuntimes,
		private views: PiAgentViews,
		private jobs: PiJobs,
		private policy: AgentAccessPolicy,
		private cwd: string,
		private authorize: ToolAuthorizer,
		private rootId: string,
		private signal: AbortSignal,
	) {
		for (const step of workflow.steps) {
			const source = this.plans.get(step.resume ?? step.fork ?? "");
			const definition = step.resume
				? source!.definition
				: selectAgent(definitions, step.agent!, "both");
			const model = step.resume
				? source!.model
				: agentModel(definition, parentModel);
			if (
				step.fork &&
				(model.provider !== source!.model.provider ||
					model.model !== source!.model.model)
			) {
				throw new Error(
					"子の fork は同じモデル・プロバイダーだけを使用できます。",
				);
			}
			this.plans.set(step.id, { step, definition, model });
		}
	}

	/** 生成済みのキーだけを認め、任意の追加起動や実行条件の差替えを拒否する。 */
	async launch(
		key: string,
		params: Record<string, unknown>,
		engineSignal: AbortSignal,
	): Promise<WorkflowResult> {
		const plan = this.plans.get(key);
		if (
			!plan ||
			this.started.has(key) ||
			typeof params.task !== "string" ||
			params.task.length > 32768
		) {
			throw new Error("ワークフローの起動要求が不正です。");
		}
		this.validateLaunch(plan.step, params);
		this.started.add(key);
		const id = this.views.start(
			this.rootId,
			`${plan.definition.name} (${key})`,
			params.task,
			this.cwd,
		);
		const signal = AbortSignal.any([this.signal, engineSignal]);
		const task = params.task;
		const done = this.jobs.submit(
			{
				id,
				parentId: this.rootId,
				status: "queued",
				background: false,
				context: plan.step.fork ? "fork" : "fresh",
			},
			signal,
			async (jobSignal) => {
				const current = await this.open(plan, id, task, jobSignal);
				const output = await promptWorkflowChild(
					current.child,
					task,
					jobSignal,
					this.views,
					id,
				);
				const messages = forkContext(
					current.child.contextSource!,
					{ provider: plan.model.provider, id: plan.model.model },
					plan.model,
				);
				const result = {
					key,
					runId: id,
					ok: true,
					output,
					artifactPaths: [],
				};
				current.latest = key;
				this.completed.set(key, {
					retained: current,
					messages,
					result,
				});
				return result;
			},
		);
		this.pending.add(done);
		try {
			return await done;
		} finally {
			this.pending.delete(done);
		}
	}

	/** Worker の要求も固定した定義と照合し、起動条件を追加・変更させない。 */
	private validateLaunch(
		step: WorkflowStep,
		params: Record<string, unknown>,
	) {
		if (!step.depends_on.every((id) => this.completed.has(id))) {
			throw new Error("依存先が完了していません。");
		}
		const expected = step.task.replace(
			/\{\{\s*([A-Za-z][A-Za-z0-9_-]{0,63})\.output\s*\}\}/g,
			(_match, id: string) => this.completed.get(id)!.result.output,
		);
		if (
			params.task !== expected ||
			params.agent !== step.agent ||
			params.resume !== this.referenceId(step.resume) ||
			params.neritaFork !== this.referenceId(step.fork) ||
			Object.keys(params).some(
				(key) =>
					!["task", "agent", "resume", "neritaFork"].includes(key),
			)
		) {
			throw new Error("生成したステップと起動条件が一致しません。");
		}
	}

	/** 未指定の参照を別のステップへ解決しない。 */
	private referenceId(id: string | undefined) {
		return id ? this.completed.get(id)?.result.runId : undefined;
	}

	/** 再開にも起動承認を要求し、既存の子へ重ねて prompt を送らない。 */
	private async open(
		plan: Plan,
		id: string,
		task: string,
		signal: AbortSignal,
	) {
		const source = this.source(plan.step);
		if (plan.step.resume && source!.retained.latest !== plan.step.resume) {
			throw new Error("古い完了時点からは再開できません。");
		}
		const permit = await approveToolCall(
			{
				tool: "extension:subagent",
				cwd: this.cwd,
				policy: this.policy,
				params: { step: plan.step, task, model: plan.model },
			},
			this.jobs.authorizer(id, this.authorize),
			signal,
		);
		consumeApprovedToolCall(permit);
		if (plan.step.resume) {
			const current = source!.retained;
			current.latest = "";
			Object.assign(current.approval, {
				id,
				agent: plan.definition.name,
				task,
			});
			return current;
		}
		const approval = { id, agent: plan.definition.name, task };
		const tools = (plan.definition.tools ?? supportedTools).filter((tool) =>
			supportedTools.includes(tool),
		);
		const child = await this.children.open({
			cwd: this.cwd,
			signal: permit.signal,
			initialMessages: initialMessages(source),
			workflowApproval: approval,
			preferredModel: plan.model,
			systemPrompt: plan.definition.prompt,
			systemPromptMode: plan.definition.systemPromptMode ?? "append",
			allowedTools: tools,
			role: workflowRole(
				tools,
				source?.retained.child.accessPolicy ?? this.policy,
			),
		});
		const current = { child, approval, latest: "" };
		this.retained.add(current);
		return current;
	}

	/** 依存先のない新規子には複製元を割り当てない。 */
	private source(step: WorkflowStep) {
		return this.completed.get(step.resume ?? step.fork ?? "");
	}

	/** 結果参照はこのワークフローの完了済みステップに限定する。 */
	status(id: string) {
		const found = [...this.completed.values()].find(
			(item) => item.result.key === id || item.result.runId === id,
		);
		if (!found) {
			throw new Error("完了したステップがありません。");
		}
		return found.result;
	}
	/** スクリプトの成功・失敗・停止のいずれでも、保持した SDK を回収する。 */
	async close() {
		await Promise.allSettled([...this.pending]);
		const settled = await Promise.allSettled(
			[...this.retained].map((item) => item.child.close()),
		);
		this.retained.clear();
		if (settled.some((item) => item.status === "rejected")) {
			throw new Error("保持した子を終了できませんでした。");
		}
	}
}

/** 完了時のスナップショットを複製し、継続元の変更から分離する。 */
function initialMessages(source: Completed | undefined) {
	return structuredClone(source?.messages ?? []);
}

/** 複製元の権限を上限にして、Agent のツール指定でさらに制限する。 */
function workflowRole(tools: string[], policy: AgentAccessPolicy) {
	return {
		writableRoots: tools.some((tool) => ["write", "edit"].includes(tool))
			? policy.writableRoots
			: [],
		shell:
			tools.some((tool) =>
				["powershell", "pwsh", "bash"].includes(tool),
			) && policy.shell,
	};
}

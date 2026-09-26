// 単一の subagent 要求を Host 管理の子へ変換し、結果を親へ返す。
import { resolve } from "node:path";
import { z } from "zod";
import { subagentInputSchema } from "./PiSubagentInput";
import { PiAgentViews } from "./PiAgentViews";
import { guardrailRegistry } from "../../security/GuardrailRegistry";
import { subagentAuthorizer } from "./PiChildSettings";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PiChildRuntimes } from "./PiChildRuntimes";
import type { PiSubagentDefinition } from "./PiSubagentDefinitions";
import type { PiModelSelection } from "./PiRuntime";
import {
	approveToolCall,
	type ToolAuthorizer,
} from "../../security/ApprovalGuard";
import {
	consumeApprovedToolCall,
	freezeToolCall,
} from "../../security/ApprovedToolCall";
import type { AgentAccessPolicy } from "../../security/AgentAccessPolicy";

const supportedTools = [
	"read",
	"ls",
	"write",
	"edit",
	"powershell",
	"pwsh",
	"bash",
];

/** 親の終了・設定変更・個別取消しを子の起動へ伝える。 */
function subagentSignal(
	policy: AgentAccessPolicy,
	cwd: string,
	lifetime: AbortSignal,
	signal: AbortSignal | undefined,
) {
	return AbortSignal.any([
		lifetime,
		guardrailRegistry.snapshot(
			policy.guardrailsRoot ?? cwd,
			policy.guardrailsRoot
				? [policy.guardrailsRoot]
				: policy.workspaceRoots,
		).signal,
		...(signal ? [signal] : []),
	]);
}

/** 定義がある親だけに委譲用 Tool を公開する。 */
export function createPiSubagentTools(
	...args: Parameters<typeof createPiSubagentTool>
): ToolDefinition[] {
	return args[0].length ? [createPiSubagentTool(...args)] : [];
}

/** 子起動の承認と子自身の操作承認を分け、独立 CLI へのフォールバックを持たない。 */
export function createPiSubagentTool(
	definitions: PiSubagentDefinition[],
	children: PiChildRuntimes,
	policy: AgentAccessPolicy,
	cwd: string,
	authorize: ToolAuthorizer,
	lifetime: AbortSignal,
	views = new PiAgentViews(),
): ToolDefinition {
	const agents = freezeToolCall(definitions);
	return {
		name: "subagent",
		label: "Subagent",
		executionMode: "sequential",
		description: `Nerita guarded foreground adapter for pi-subagents definitions, always fresh context. Native workflowScript, background async, fork context and external runners are unsupported. Available agents: ${availableAgentNames(agents)}`,
		// SDK の実行契約は JSON Schema。入力は実行時にも Zod で検証する。
		parameters: {
			type: "object",
			...z.toJSONSchema(subagentInputSchema, { io: "input" }),
		},
		async execute(_id, params, signal, update, context) {
			const input = subagentInputSchema.parse(params);
			const combined = subagentSignal(policy, cwd, lifetime, signal);
			combined.throwIfAborted();
			const targetCwd = resolve(cwd, input.cwd ?? ".");
			const viewId = views.start(_id, input.agent, input.task, targetCwd);
			try {
				const definition = selectAgent(
					agents,
					input.agent,
					input.agentScope,
				);
				const tools = (definition.tools ?? supportedTools).filter(
					(tool) => supportedTools.includes(tool),
				);
				const preferredModel = agentModel(
					withModel(definition, input.model),
					context.model,
				);
				const permit = await approveToolCall(
					{
						tool: "extension:subagent",
						cwd: targetCwd,
						policy,
						params: {
							...input,
							definition,
							tools,
							preferredModel,
						},
					},
					subagentAuthorizer(authorize, {
						agent: definition.name,
						task: input.task,
					}),
					combined,
				);
				consumeApprovedToolCall(permit);
				const child = await children.open({
					cwd: targetCwd,
					signal: permit.signal,
					role: {
						...(!tools.some((tool) =>
							["write", "edit"].includes(tool),
						)
							? { writableRoots: [] }
							: {}),
						shell: tools.some((tool) =>
							["powershell", "pwsh", "bash"].includes(tool),
						),
					},
					allowedTools: tools,
					systemPrompt: definition.prompt,
					...promptMode(definition),
					preferredModel,
					approvalContext: {
						agent: definition.name,
						task: input.task,
					},
				});
				views.status(viewId, "running");
				let output = "";
				let failed = false;
				const unsubscribe = child.subscribe((event) => {
					views.event(viewId, event);
					if (event.type === "tool_execution_end" && event.isError) {
						failed = true;
					}
					if (
						event.type === "message_end" &&
						event.message.role === "assistant"
					) {
						output = event.message.content
							.filter((part) => part.type === "text")
							.map((part) => part.text)
							.join("\n")
							.slice(0, 32768);
						failed ||= ["error", "aborted"].includes(
							event.message.stopReason,
						);
					}
				});
				try {
					update?.({
						content: [
							{
								type: "text",
								text: `${definition.name} を実行中`,
							},
						],
						details: { agent: definition.name },
					});
					await child.prompt(input.task);
					permit.signal.throwIfAborted();
					if (failed) {
						throw new Error(
							output || "サブエージェントの実行に失敗しました。",
						);
					}
					views.status(viewId, "completed");
					return {
						content: [
							{
								type: "text",
								text:
									output ||
									"子から本文の応答がありませんでした。",
							},
						],
						details: {
							agent: definition.name,
							source: definition.source,
							tools,
						},
						isError: failed,
					};
				} finally {
					unsubscribe();
					await child.close();
				}
			} catch (error) {
				views.status(
					viewId,
					combined.aborted ? "interrupted" : "errored",
				);
				throw error;
			}
		},
	};
}

/** プロジェクト定義は明示したスコープだけで採用する。 */
function selectAgent(
	agents: PiSubagentDefinition[],
	name: string,
	scope: "user" | "project" | "both",
) {
	const eligible = agents.filter(
		(agent) =>
			(agent.name === name || agent.aliases?.includes(name)) &&
			(agent.source === "extension" ||
				scope === "both" ||
				agent.source === scope),
	);
	const agent = eligible.at(-1);
	if (!agent) {
		throw new Error(`サブエージェント定義がありません: ${name}`);
	}
	if (agent.unavailableReason) {
		throw new Error(agent.unavailableReason);
	}
	return agent;
}

/** 未指定モデルは呼出時の親モデルを使い、定義のモデル指定は厳密に解決する。 */
function agentModel(
	definition: PiSubagentDefinition,
	parent: { provider: string; id: string } | undefined,
): PiModelSelection {
	if (!parent) {
		throw new Error("親モデルが未選択です。");
	}
	const raw = definition.model ?? parent.id;
	const match = /:(off|minimal|low|medium|high|xhigh|max)$/.exec(raw);
	const model = match ? raw.slice(0, match.index) : raw;
	const slash = definition.model ? model.indexOf("/") : -1;
	const reasoning = definition.thinking ?? match?.[1];
	return {
		provider: slash > 0 ? model.slice(0, slash) : parent.provider,
		model: slash > 0 ? model.slice(slash + 1) : model,
		...(reasoning ? { reasoning } : {}),
	};
}

/** 呼出し側の明示モデルだけを定義より優先する。 */
function withModel(
	definition: PiSubagentDefinition,
	model: string | undefined,
) {
	return model ? { ...definition, model } : definition;
}

/** プロンプトの置換指定を子の起動契約へ渡す。 */
function promptMode(definition: PiSubagentDefinition) {
	return {
		systemPromptMode: definition.systemPromptMode ?? ("append" as const),
	};
}

/** 未対応の外部実行定義は候補に宣伝せず、明示指定時には選択処理で拒否する。 */
function availableAgentNames(agents: PiSubagentDefinition[]) {
	return [
		...new Set(
			agents
				.filter((agent) => !agent.unavailableReason)
				.flatMap((agent) => [agent.name, ...(agent.aliases ?? [])]),
		),
	].join(", ");
}

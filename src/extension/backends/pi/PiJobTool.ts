// 親モデルへジョブの一覧・結果取得・個別取消しだけを公開する。
import { z } from "zod";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { PiJobs } from "./PiJobs";

const inputSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("list") }).strict(),
	z
		.object({
			action: z.enum(["read", "cancel"]),
			jobId: z.string().min(1),
		})
		.strict(),
]);
/** 外部 runner や他セッションの ID へ処理を委譲しない。 */
export function createPiJobTool(jobs: PiJobs): ToolDefinition {
	return {
		name: "subagent_job",
		label: "Subagent jobs",
		description:
			"List, read results, or cancel this session's subagent jobs. Restored jobs are read-only history.",
		parameters: {
			type: "object",
			...z.toJSONSchema(inputSchema, { io: "input" }),
		},
		async execute(_id, params, signal) {
			signal?.throwIfAborted();
			const input = inputSchema.parse(params);
			if (input.action === "cancel") {
				await jobs.cancel(input.jobId);
			}
			const result =
				input.action === "list" ? jobs.list() : jobs.read(input.jobId);
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				details: result,
			};
		},
	};
}

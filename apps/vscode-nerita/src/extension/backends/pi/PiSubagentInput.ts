// 子エージェント1つの起動に使う入力を検証し、未対応の項目は拒否する。
import { z } from "zod";

export const subagentInputSchema = z
	.object({
		agent: z.string().min(1).max(80),
		task: z.string().min(1).max(32768),
		cwd: z.string().max(4096).optional(),
		model: z.string().min(1).max(512).optional(),
		context: z.enum(["fresh", "fork"]).optional(),
		async: z.boolean().optional(),
		agentScope: z.enum(["user", "project", "both"]).default("both"),
	})
	.strict();

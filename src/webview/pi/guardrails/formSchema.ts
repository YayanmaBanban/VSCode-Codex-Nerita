// 入力途中の空欄もフォームで保持し、厳密な検証は検査・保存時に行う。
import { z } from "zod";
import {
	guardrailsConfigSchema,
	pathRuleSchema,
	commandRuleSchema,
	operationSchema,
} from "../../../shared/guardrails/config";

export const guardrailsFormSchema = guardrailsConfigSchema.extend({
	pathRules: z.array(
		pathRuleSchema.extend({
			id: z.string(),
			reason: z.string(),
			pattern: z.string(),
			exceptions: z.array(z.string()),
			operations: z.array(operationSchema),
		}),
	),
	commandRules: z.array(
		commandRuleSchema.extend({
			id: z.string(),
			reason: z.string(),
			pattern: z.string(),
		}),
	),
});

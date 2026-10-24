// 設定には適用しない編集途中の値を、復元前の比較値とともに保持する。
import { z } from "zod";
import {
	agentEditSchema,
	backendSchema,
	handoffSchema,
	piDefaultsSchema,
} from "./config";

const editSchema = agentEditSchema.extend({
	definition: z
		.strictObject({
			name: z.string().max(80),
			description: z.string().max(2000),
			prompt: z.string().max(60000),
		})
		.optional(),
});
// JSON の null は空欄・数値未確定の入力として復元し、設定保存時の検証とは分ける。
const draftNumber = z.preprocess(
	(value) => (value === null ? Number.NaN : value),
	z.union([z.number(), z.nan()]),
);
const defaultsSchema = piDefaultsSchema.extend({
	maxSubagentSpawnsPerSession: draftNumber.optional(),
});
const handoffDraftSchema = handoffSchema.extend({
	defaults: z.strictObject({ timeoutMs: draftNumber }),
});
export const draftChangeSchema = z.discriminatedUnion("type", [
	z.strictObject({
		type: z.literal("agent"),
		agentId: z.string().max(1024),
		edit: editSchema,
	}),
	z.strictObject({
		type: z.literal("createAgent"),
		backend: backendSchema,
		filename: z.string().max(80),
		edit: editSchema,
	}),
	z.strictObject({ type: z.literal("defaults"), defaults: defaultsSchema }),
	z.strictObject({
		type: z.literal("handoff"),
		backend: backendSchema,
		config: handoffDraftSchema,
	}),
]);
/** 下書きは設定ファイルのパスを指定できず、復元後も通常の保存検証を通る。 */
const draftDataSchema = z.strictObject({
	version: z.literal(1),
	backend: backendSchema,
	base: draftChangeSchema.nullable(),
	change: draftChangeSchema,
});
/** 元の値と編集値が同じ対象であり、バックエンドの混在がないことを確認する。 */
function matchingTargets(draft: z.infer<typeof draftDataSchema>) {
	const change = draft.change;
	if ("backend" in change && change.backend !== draft.backend) {
		return false;
	}
	if (change.type === "createAgent") {
		return draft.base === null;
	}
	if (draft.base === null || draft.base.type !== change.type) {
		return false;
	}
	if (change.type === "agent" && draft.base.type === "agent") {
		return change.agentId === draft.base.agentId;
	}
	return !("backend" in draft.base) || draft.base.backend === draft.backend;
}
export const managerDraftSchema = draftDataSchema.refine(
	matchingTargets,
	"下書きの比較元と編集対象が一致しません。",
);
/** 編集途中の値。設定へ保存する前には通常の設定スキーマで再検証する。 */
export type DraftChange = z.infer<typeof draftChangeSchema>;
/** ワークスペースに退避する元の値と編集後の値。 */
export type ManagerDraft = z.infer<typeof managerDraftSchema>;

// 実行記録を state.json から分離し、Host の信頼済みダイジェストと照合して復元する。
import { z } from "zod";
import { DlcTaskSchema, DlcPathSchema } from "@nerita/shared/dlc/contracts";
import {
	AttemptSchema,
	IntentStateBodySchema,
	IntentStateSchema,
	type IntentMetadata,
	type IntentState,
} from "@nerita/dlc/state";
import {
	SemanticResultSchema,
	RuntimeEvidenceSchema,
} from "@nerita/dlc/runtime";
import { DigestSchema } from "@nerita/dlc/workspace";
import { type SafeDlcFiles, jsonDigest } from "./SafeDlcFiles";

export const StateDiskSchema = IntentStateBodySchema.extend({
	workItems: z
		.array(
			DlcTaskSchema.extend({
				id: z.string().min(1),
				status: IntentStateBodySchema.shape.workItems.element.shape
					.status,
				attempts: z.array(
					AttemptSchema.omit({ result: true, evidence: true }).extend(
						{
							receipt: z
								.strictObject({
									path: DlcPathSchema,
									digest: DigestSchema,
								})
								.nullable(),
						},
					),
				),
			}),
		)
		.max(50),
});
export type StateDisk = z.infer<typeof StateDiskSchema>;
const receiptSchema = z.strictObject({
	schemaVersion: z.literal(1),
	intentId: z.uuid(),
	workItemId: z.string(),
	attemptId: z.string(),
	result: SemanticResultSchema.nullable(),
	evidence: RuntimeEvidenceSchema.nullable(),
});

/** 証跡は内容アドレスのファイルとして保存し、既存の同名ファイルを上書きしない。 */
export async function persistState(
	files: SafeDlcFiles,
	directory: string,
	state: IntentState,
): Promise<StateDisk> {
	const workItems: StateDisk["workItems"] = [];
	await files.directory(`${directory}/runs`);
	for (const item of state.workItems) {
		const attempts: StateDisk["workItems"][number]["attempts"] = [];
		for (const attempt of item.attempts) {
			attempts.push(
				await persistAttempt(
					files,
					directory,
					state.intentId,
					item.id,
					attempt,
				),
			);
		}
		workItems.push({ ...item, attempts });
	}
	const { intent: _intent, ...body } = state;
	return StateDiskSchema.parse({ ...body, workItems });
}

/** ハッシュだけでなく Intent・作業・試行の参照を照合してからドメインへ渡す。 */
export async function restoreState(
	files: SafeDlcFiles,
	directory: string,
	disk: StateDisk,
	intent: IntentMetadata,
): Promise<IntentState> {
	const workItems: IntentState["workItems"] = [];
	for (const item of disk.workItems) {
		const attempts: IntentState["workItems"][number]["attempts"] = [];
		for (const attempt of item.attempts) {
			const { receipt, ...summary } = attempt;
			if (receipt === null) {
				attempts.push({ ...summary, result: null, evidence: null });
				continue;
			}
			if (receipt.path !== `runs/${receipt.digest.slice(7)}.json`) {
				throw new Error("実行根拠の参照が不正です。");
			}
			const text = await files.read(
				`${directory}/${receipt.path}`,
				80 * 1024 * 1024,
			);
			if (text === undefined) {
				throw new Error("実行根拠のファイルがありません。");
			}
			const record = receiptSchema.parse(JSON.parse(text));
			if (
				jsonDigest(record) !== receipt.digest ||
				record.intentId !== disk.intentId ||
				record.workItemId !== item.id ||
				record.attemptId !== attempt.id
			) {
				throw new Error("実行根拠の参照またはハッシュが一致しません。");
			}
			attempts.push({
				...summary,
				result: record.result,
				evidence: record.evidence,
			});
		}
		workItems.push({ ...item, attempts });
	}
	return IntentStateSchema.parse({ ...disk, intent, workItems });
}

async function persistAttempt(
	files: SafeDlcFiles,
	directory: string,
	intentId: string,
	workItemId: string,
	attempt: IntentState["workItems"][number]["attempts"][number],
): Promise<StateDisk["workItems"][number]["attempts"][number]> {
	const { result, evidence, ...summary } = attempt;
	let receipt: StateDisk["workItems"][number]["attempts"][number]["receipt"] =
		null;
	if (result !== null || evidence !== null) {
		const record = receiptSchema.parse({
			schemaVersion: 1,
			intentId,
			workItemId,
			attemptId: attempt.id,
			result,
			evidence,
		});
		const digest = jsonDigest(record);
		const path = `runs/${digest.slice(7)}.json`;
		const previous = await files.read(
			`${directory}/${path}`,
			80 * 1024 * 1024,
		);
		if (
			previous !== undefined &&
			jsonDigest(JSON.parse(previous)) !== digest
		) {
			throw new Error("既存の実行根拠が破損しています。");
		}
		if (previous === undefined) {
			await files.write(`${directory}/${path}`, record);
		}
		receipt = { path, digest };
	}
	return { ...summary, receipt };
}

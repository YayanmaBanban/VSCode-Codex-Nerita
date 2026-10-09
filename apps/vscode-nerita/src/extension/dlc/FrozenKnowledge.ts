// 実行開始時に Markdown の本文と参照を固定し、外部サービスや実行中の変更に依存させない。
import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { DlcPathSchema } from "@nerita/shared/dlc/contracts";
import { DigestSchema } from "@nerita/dlc/workspace";
import { type SafeDlcFiles, jsonDigest } from "./SafeDlcFiles";

export const FrozenKnowledgeSchema = z
	.strictObject({
		schemaVersion: z.literal(1),
		digest: DigestSchema,
		entries: z
			.array(
				z.strictObject({
					source: DlcPathSchema,
					scope: z.enum([
						"space-memory",
						"space-knowledge",
						"intent",
					]),
					digest: DigestSchema,
					text: z.string(),
				}),
			)
			.max(100),
	})
	.superRefine((value, context) => {
		if (
			value.digest !== jsonDigest(value.entries) ||
			new Set(value.entries.map((entry) => entry.source)).size !==
				value.entries.length ||
			value.entries.some(
				(entry) => entry.digest !== textDigest(entry.text),
			)
		) {
			context.addIssue({
				code: "custom",
				message: "固定した Knowledge のハッシュが一致しません。",
			});
		}
	});
export type FrozenKnowledge = z.infer<typeof FrozenKnowledgeSchema>;
function textDigest(text: string): string {
	return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

/** JSON の管理状態は参照せず、承認済みの Markdown 領域だけを収集する。 */
export async function freezeKnowledge(
	files: SafeDlcFiles,
	intentDirectory: string,
	signal: AbortSignal,
): Promise<FrozenKnowledge> {
	const entries: FrozenKnowledge["entries"] = [];
	// `artifacts` 内の学習候補は、採用機能を実装するまで自動参照しない。
	await files.directory(`${intentDirectory}/artifacts`);
	let total = 0;
	let visited = 0;
	const deadline = Date.now() + 30_000;
	const walk = async (
		directory: string,
		scope: FrozenKnowledge["entries"][number]["scope"],
		depth: number,
	): Promise<void> => {
		signal.throwIfAborted();
		if (depth > 8) {
			throw new Error("Knowledge の階層上限を超えています。");
		}
		for (const entry of (
			await readdir(await files.path(directory), { withFileTypes: true })
		).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
			signal.throwIfAborted();
			if (++visited > 10_000 || Date.now() > deadline) {
				throw new Error("Knowledge の収集上限を超えています。");
			}
			const source = `${directory}/${entry.name}`;
			await files.path(source);
			if (entry.isDirectory()) {
				await walk(source, scope, depth + 1);
			} else if (entry.name.toLowerCase().endsWith(".md")) {
				const text = await files.read(source, 1024 * 1024);
				if (text === undefined) {
					throw new Error("Knowledge が収集中に変更されました。");
				}
				total += Buffer.byteLength(text);
				if (entries.length >= 100 || total > 2 * 1024 * 1024) {
					throw new Error("Knowledge の収集上限を超えています。");
				}
				entries.push({ source, scope, text, digest: textDigest(text) });
			}
		}
	};
	for (const [directory, scope] of [
		[".nerita/dlc/spaces/default/memory", "space-memory"],
		[".nerita/dlc/spaces/default/knowledge", "space-knowledge"],
	] as const) {
		await files.directory(directory);
		await walk(directory, scope, 0);
	}
	entries.sort((a, b) => a.source.localeCompare(b.source, "en"));
	return FrozenKnowledgeSchema.parse({
		schemaVersion: 1,
		digest: jsonDigest(entries),
		entries,
	});
}

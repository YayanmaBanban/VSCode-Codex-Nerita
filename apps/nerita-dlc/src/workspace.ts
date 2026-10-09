// 検出済みの構造情報を検証する。実行能力・承認・工程の進行状態は扱わない。
import { z } from "zod";
import {
	DlcPathSchema,
	DlcProjectTypeSchema,
} from "@nerita/shared/dlc/contracts";

/** ルート自身の参照だけは「.」を許容する。 */
export const WorkspacePathSchema = z.union([z.literal("."), DlcPathSchema]);
export const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const ProjectTypeSchema = DlcProjectTypeSchema;
const FactSchema = z.strictObject({
	name: z.string().min(1),
	evidence: z.array(DlcPathSchema).min(1),
});

/** 再生成できる検出結果だけを保存し、スクリプト本文や機械固有値を含めない。 */
export const WorkspaceDetectionSchema = z
	.strictObject({
		schemaVersion: z.literal(1),
		kind: z.literal("workspace-detection"),
		detectorVersion: z.literal(1),
		classification: z.strictObject({
			detected: ProjectTypeSchema,
			evidence: z.array(DlcPathSchema),
		}),
		repository: z.strictObject({
			vcs: z.literal("git"),
			root: z.literal("."),
			submodules: z.boolean(),
		}),
		layout: z.strictObject({
			kind: z.enum(["single", "monorepo"]),
			definition: DlcPathSchema.nullable(),
			packageManager: z.enum(["pnpm", "npm", "yarn", "bun", "unknown"]),
		}),
		projects: z.array(
			z.strictObject({
				root: WorkspacePathSchema,
				name: z.string().min(1),
				manifest: DlcPathSchema,
			}),
		),
		languages: z.array(FactSchema),
		frameworks: z.array(
			FactSchema.extend({ projectRoot: WorkspacePathSchema }),
		),
		declaredScripts: z.array(
			z.strictObject({
				projectRoot: WorkspacePathSchema,
				source: DlcPathSchema,
				names: z.array(z.string().min(1)),
			}),
		),
		practices: z.array(DlcPathSchema),
		scan: z.strictObject({
			status: z.literal("complete"),
			inputFingerprint: DigestSchema,
			warnings: z.array(z.string()),
		}),
	})
	.superRefine((value, context) => {
		const roots = value.projects.map((project) => project.root);
		const manifests = value.projects.map((project) => project.manifest);
		if (
			new Set(roots).size !== roots.length ||
			new Set(manifests).size !== manifests.length
		) {
			context.addIssue({
				code: "custom",
				message:
					"プロジェクトのルートまたはマニフェストが重複しています。",
			});
		}
		for (const project of value.projects) {
			const directory = project.manifest
				.split("/")
				.slice(0, -1)
				.join("/");
			const parent = directory === "" ? "." : directory;
			if (parent !== project.root) {
				context.addIssue({
					code: "custom",
					message:
						"マニフェストとプロジェクトのルートが一致しません。",
				});
			}
		}
		for (const fact of [...value.frameworks, ...value.declaredScripts]) {
			if (!roots.includes(fact.projectRoot)) {
				context.addIssue({
					code: "custom",
					message: "検出情報のプロジェクト参照がありません。",
				});
			}
		}
	});
export type WorkspaceDetection = z.infer<typeof WorkspaceDetectionSchema>;

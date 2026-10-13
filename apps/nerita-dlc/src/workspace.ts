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
const WorkspaceDetectionShapeSchema = z.strictObject({
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
});

/** フィールドの形式に加え、プロジェクト参照とマニフェストの整合性を検証する。 */
export const WorkspaceDetectionSchema =
	WorkspaceDetectionShapeSchema.superRefine(validateWorkspaceReferences);
/** プロジェクトの検出事実と分類。外部入力は `WorkspaceDetectionSchema` で検証してから扱う。 */
export type WorkspaceDetection = z.infer<typeof WorkspaceDetectionSchema>;

/** 重複と未解決の参照を全件報告し、個々のフィールドだけでは分からない構成の不一致を拒否する。 */
function validateWorkspaceReferences(
	value: z.infer<typeof WorkspaceDetectionShapeSchema>,
	context: z.RefinementCtx,
): void {
	const roots = value.projects.map((project) => project.root);
	const manifests = value.projects.map((project) => project.manifest);
	const matchesSize =
		new Set(roots).size !== roots.length ||
		new Set(manifests).size !== manifests.length;
	if (matchesSize) {
		context.addIssue({
			code: "custom",
			message: "プロジェクトのルートまたはマニフェストが重複しています。",
		});
	}
	for (const project of value.projects) {
		const directory = project.manifest.split("/").slice(0, -1).join("/");
		const parent = directory === "" ? "." : directory;
		if (parent !== project.root) {
			context.addIssue({
				code: "custom",
				message: "マニフェストとプロジェクトのルートが一致しません。",
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
}

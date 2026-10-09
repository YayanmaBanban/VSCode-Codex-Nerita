// AI-DLC の工程と静的な適用表を固定する。工程の実処理は後続フェーズのハンドラーへ委譲する。
import {
	ExecutionProfileSchema,
	type ExecutionProfile,
} from "@nerita/shared/dlc/contracts";

/** 条件の未確定は明示的に停止させ、LLM の推測で工程を省略しない。 */
export type StageCondition =
	| "always"
	| "brownfield"
	| "ui"
	| "market"
	| "feasibility"
	| "team"
	| "nfr"
	| "infrastructure"
	| "ci"
	| "deployment"
	| "observability"
	| "incident"
	| "performance";
export type StageDefinition = {
	id: string;
	name: string;
	phase: number;
	dependencies: string[];
	condition: StageCondition;
	produces: string[];
	consumes: { stageId: string; artifact: string }[];
	approval: boolean;
	repetition: "intent" | "unit";
	handlerId: string;
	profiles: ExecutionProfile[];
};

// 2026-10-08 の AWS Stage-by-Scope Matrix を固定する。件数ではなく各セルを回帰検証する。
// 出典: [適用表](https://github.com/awslabs/aidlc-workflows/blob/main/docs/guide/05-scopes-and-depth.md)。
const all = ExecutionProfileSchema.options;
const full: ExecutionProfile[] = ["enterprise", "feature"];
const design: ExecutionProfile[] = [...full, "mvp", "classic", "workshop"];
const implementation: ExecutionProfile[] = [
	...design,
	"poc",
	"bugfix",
	"refactor",
	"security-patch",
	"express",
];

/** 成果物の ID は Nerita の契約。上流の保存形式やツール実装は移植しない。 */
const rows: [string, string, StageCondition, ExecutionProfile[]][] = [
	["0.1", "Workspace Scaffold", "always", all],
	["0.2", "Workspace Detection", "always", all],
	["0.3", "State Initialization", "always", all],
	["1.1", "Intent Capture & Framing", "always", [...full, "mvp", "poc"]],
	["1.2", "Market Research", "market", full],
	["1.3", "Feasibility & Constraints", "feasibility", [...full, "mvp"]],
	["1.4", "Scope Definition", "always", [...full, "mvp"]],
	["1.5", "Team Formation", "team", full],
	["1.6", "Rough Mockups", "ui", [...full, "mvp"]],
	["1.7", "Approval & Handoff", "always", full],
	["2.1", "Reverse Engineering", "brownfield", implementation],
	["2.2", "Practices Discovery", "always", [...design, "infra"]],
	["2.3", "Requirements Analysis", "always", all],
	["2.4", "User Stories", "always", design],
	["2.5", "Refined Mockups", "ui", design],
	["2.6", "Domain Design", "always", design],
	["2.7", "Units Generation", "always", design],
	["2.8", "Contract Design", "always", design],
	["2.9", "Delivery Planning", "always", design],
	["3.1", "Functional Design", "always", [...design, "refactor"]],
	["3.2", "NFR Requirements", "nfr", [...design, "infra", "security-patch"]],
	["3.3", "NFR Design", "nfr", [...design, "infra"]],
	["3.4", "Infrastructure Design", "infrastructure", [...design, "infra"]],
	["3.5", "Code Generation", "always", implementation],
	["3.6", "Build and Test", "always", implementation],
	["3.7", "CI Pipeline", "ci", [...full, "mvp", "infra", "workshop"]],
	[
		"4.1",
		"Deployment Pipeline",
		"deployment",
		[
			...full,
			"bugfix",
			"refactor",
			"infra",
			"security-patch",
			"workshop",
			"express",
		],
	],
	[
		"4.2",
		"Environment Provisioning",
		"infrastructure",
		[...full, "infra", "workshop"],
	],
	[
		"4.3",
		"Deployment Execution",
		"deployment",
		[
			...full,
			"bugfix",
			"refactor",
			"infra",
			"security-patch",
			"workshop",
			"express",
		],
	],
	[
		"4.4",
		"Observability Setup",
		"observability",
		[...full, "infra", "workshop", "express"],
	],
	["4.5", "Incident Response", "incident", [...full, "workshop"]],
	["4.6", "Performance Validation", "performance", [...full, "workshop"]],
	["4.7", "Feedback & Optimization", "always", [...full, "workshop"]],
];
export const catalogVersion = 1;
export const profileVersion = 1;
export const stageCatalog: readonly StageDefinition[] = rows.map(
	([id, name, condition, profiles], index) => {
		const previous = index === 0 ? undefined : rows[index - 1];
		const dependencies = previous === undefined ? [] : [previous[0]];
		if (!id.startsWith("0.") && !dependencies.includes("0.3")) {
			dependencies.unshift("0.3");
		}
		return {
			id,
			name,
			phase: Number(id[0]),
			condition,
			profiles: [...profiles],
			dependencies,
			produces: [stageArtifact(id)],
			consumes: dependencies.map((stageId) => ({
				stageId,
				artifact: stageArtifact(stageId),
			})),
			approval: !id.startsWith("0."),
			repetition: /^3\.[1-5]$/.test(id) ? "unit" : "intent",
			handlerId: `stage:${id}`,
		};
	},
);

/** 依存の向きと識別子を検証し、保存済みカタログの変更を黙って受け入れない。 */
export function validateCatalog(catalog: readonly StageDefinition[]): void {
	const ids = catalog.map((stage) => stage.id);
	if (catalog.length !== 33 || new Set(ids).size !== 33) {
		throw new Error("ステージカタログは重複のない33件が必要です。");
	}
	for (const [index, stage] of catalog.entries()) {
		if (
			stage.id !== rows[index]?.[0] ||
			stage.phase !== Number(stage.id[0]) ||
			stage.dependencies.some((id) => !ids.slice(0, index).includes(id))
		) {
			throw new Error("ステージの順序または依存関係が不正です。");
		}
		if (
			stage.consumes.some(
				(input) =>
					!catalog.some(
						(producer) =>
							producer.id === input.stageId &&
							producer.produces.includes(input.artifact),
					),
			)
		) {
			throw new Error("成果物の参照が未解決です。");
		}
		if (new Set(stage.profiles).size !== stage.profiles.length) {
			throw new Error("プロファイルが重複しています。");
		}
		stage.profiles.forEach((profile) =>
			ExecutionProfileSchema.parse(profile),
		);
	}
}

function stageArtifact(id: string): string {
	if (id === "0.2") {
		return "workspace";
	}
	if (id === "0.3") {
		return "state";
	}
	return `stage:${id}`;
}

// 33 工程を Phase 内へまとめ、表示用の集計によって保存済みの工程を進行させない。
import type {
	DlcAction,
	DlcProjection,
	DlcView,
} from "@nerita/shared/dlc/contracts";
import type { UiMessage } from "@nerita/shared/messages";
import type { ReactNode } from "react";
import { DlcWorkItems } from "./DlcWorkItems";

const phases = [
	"Initialization",
	"Ideation",
	"Inception",
	"Construction",
	"Operation",
];
const statusLabels = {
	pending: "未着手",
	active: "実行中",
	"awaiting-approval": "承認待ち",
	revising: "修正中",
	completed: "完了",
	skipped: "対象外",
};
const selectionLabels = {
	execute: "対象",
	skip: "対象外",
	undetermined: "未確定",
};

/** 初回は現在の工程を開く。利用者の展開位置があればそれを優先する。 */
export function currentPhase(selected: DlcProjection | null): number {
	const next = selected?.stages.find(
		(stage) => !["completed", "skipped"].includes(stage.status),
	);
	return next ? Number(next.id.split(".")[0]) : 0;
}

function phaseStatus(stages: DlcProjection["stages"]): string {
	if (stages.length === 0) {
		return "未着手";
	}
	if (stages.every((stage) => stage.status === "skipped")) {
		return "対象外";
	}
	if (
		stages.every((stage) => ["completed", "skipped"].includes(stage.status))
	) {
		return "完了";
	}
	if (
		stages.some((stage) =>
			["active", "awaiting-approval", "revising"].includes(stage.status),
		)
	) {
		return "進行中";
	}
	if (stages.some((stage) => stage.selection === "undetermined")) {
		return "条件の確認待ち";
	}
	return "未着手";
}

type PhaseProps = {
	selected: DlcProjection | null;
	view: DlcView;
	expanded: number[];
	onToggle: (phase: number) => void;
	action: (action: DlcAction) => void;
	send: (message: UiMessage) => void;
	initialization: ReactNode;
};
export function DlcPhases(props: PhaseProps) {
	return (
		<div className="flex flex-col gap-3">
			{phases.map((name, phase) => (
				<PhaseSection
					key={phase}
					{...props}
					name={name}
					phase={phase}
				/>
			))}
		</div>
	);
}
function PhaseSection({
	selected,
	view,
	expanded,
	onToggle,
	action,
	send,
	initialization,
	phase,
	name,
}: PhaseProps & { phase: number; name: string }) {
	const stages =
		selected?.stages.filter((stage) => stage.id.startsWith(`${phase}.`)) ??
		[];
	const open = expanded.includes(phase);
	const pending = stages.some(
		(stage) => stage.status === "pending" && stage.selection !== "skip",
	);
	return (
		<section className="overflow-hidden rounded-lg border border-solid border-panel-border">
			<h2 className="m-0 text-[13px]">
				<button
					type="button"
					disabled={selected === null}
					aria-expanded={open}
					aria-controls={`dlc-phase-${phase}`}
					className="flex w-full items-center gap-2 rounded-none border-0 bg-transparent px-4 py-3 text-left"
					onClick={() => onToggle(phase)}
				>
					<span aria-hidden="true">{open ? "▾" : "▸"}</span>
					<span className="flex-1">
						Phase {phase} · {name}
					</span>
					<span className="text-[11px] font-normal text-muted">
						{phaseStatus(stages)}
					</span>
				</button>
			</h2>
			<div
				id={`dlc-phase-${phase}`}
				hidden={!open}
				className="border-0 border-t border-solid border-panel-border px-4 py-3"
			>
				{phase === 0 && initialization}
				{selected !== null && <StageList stages={stages} />}
				{selected !== null && phase === 3 && (
					<DlcWorkItems
						selected={selected}
						active={view.active !== null}
						action={action}
						send={send}
					/>
				)}
				{phase > 0 && pending && (
					<p className="text-muted">
						この Phase の工程実行は後続フェーズで対応します。
					</p>
				)}
			</div>
		</section>
	);
}

function StageList({ stages }: { stages: DlcProjection["stages"] }) {
	return (
		<ul aria-label="工程の適用と進行" className="m-0 list-none p-0">
			{stages.map((stage) => (
				<li
					key={stage.id}
					className="border-0 border-b border-solid border-panel-border py-2 last:border-b-0"
				>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<strong className="text-[12px]">
							{stage.id} {stage.name}
						</strong>
						<span className="text-muted">
							{selectionLabels[stage.selection]} ·{" "}
							{statusLabels[stage.status]}
						</span>
					</div>
					<p className="m-0 mt-1 text-[11px] break-words text-muted">
						{stage.reason}
					</p>
				</li>
			))}
		</ul>
	);
}

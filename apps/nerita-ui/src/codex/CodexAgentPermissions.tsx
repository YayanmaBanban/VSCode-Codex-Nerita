// サンドボックス・承認者と承認要求の種類を Codex の保存形式で編集する。
import { nonEmptyString } from "@nerita/shared/valuePredicates";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "cnfast";
import {
	agentEditSchema,
	granularApprovalSchema,
	type AgentEdit,
} from "@nerita/shared/agentManager/config";
import {
	codexSandboxChoices,
	codexReviewerChoices,
	permissionControl,
} from "@nerita/shared/settingsCards";
import { SliderCard } from "../contributions/SliderCard";
import { managerOption } from "../agentManager/AgentModelControl";
import { Field, inputStyle } from "../agentManager/Fields";
import { SettingsTooltip } from "../chat/SettingsTooltip";

const granularLabels = {
	sandbox_approval: "サンドボックス外での実行",
	rules: "ルールによる承認要求",
	skill_approval: "スキルの承認",
	request_permissions: "追加権限の要求",
	mcp_elicitations: "MCP からの入力要求",
};

const approvalDescriptions: Record<string, string> = {
	"on-request": "サンドボックス外の実行操作で承認を求める",
	never: "承認なし",
	granular: "承認の種類ごとに決める",
};

/** 非表示の承認者も保持し、サンドボックスを戻した際に復元する。 */
export function CodexAgentPermissions({
	edit,
	onChange,
	disabled,
}: {
	edit: AgentEdit;
	onChange: (edit: AgentEdit) => void;
	disabled: boolean;
}) {
	const mode = managerOption(
		"mode",
		"サンドボックスモード",
		edit.sandboxMode,
		codexSandboxChoices,
		false,
	);
	const reviewer = managerOption(
		"approvals_reviewer",
		"承認者",
		edit.approvalsReviewer,
		codexReviewerChoices,
		false,
	);

	return (
		<AdvancedPermissions>
			<div className="mt-4 grid gap-4">
				<div className="flex items-center gap-2 text-sm">
					<span>サンドボックスモード</span>
					<SliderCard
						control={permissionControl(mode, [reviewer])}
						outlined
						disabled={disabled}
						onChange={(key, value) =>
							onChange(
								key === "mode"
									? {
											...edit,
											sandboxMode:
												agentEditSchema.shape.sandboxMode.parse(
													nonEmptyString(value) ??
														undefined,
												),
										}
									: {
											...edit,
											approvalsReviewer:
												agentEditSchema.shape.approvalsReviewer.parse(
													nonEmptyString(value) ??
														undefined,
												),
										},
							)
						}
					/>
				</div>
				<ApprovalPolicyField edit={edit} onChange={onChange} />
			</div>
		</AdvancedPermissions>
	);
}

/** 内容を保持して高さを補間し、閉じた設定への操作を防ぐ。 */
function AdvancedPermissions({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const id = useId();
	return (
		<section className="border-t border-input-border pt-4">
			<button
				type="button"
				aria-expanded={open}
				aria-controls={id}
				onClick={() => setOpen((value) => !value)}
				className="flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-focus"
			>
				<ChevronRight
					size={14}
					aria-hidden="true"
					className={cn(
						"transition-transform duration-[220ms] ease-out motion-reduce:transition-none",
						open && "rotate-90",
					)}
				/>
				高度な設定
			</button>
			<div
				id={id}
				inert={!open}
				aria-hidden={!open}
				className={cn(
					"grid transition-[grid-template-rows] duration-[220ms]",
					"ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
					open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
				)}
			>
				<div className="min-h-0 overflow-hidden">{children}</div>
			</div>
		</section>
	);
}

/** `granular` の選択時だけ承認要求の種類を編集する。 */
function ApprovalPolicyField({
	edit,
	onChange,
}: {
	edit: AgentEdit;
	onChange: (edit: AgentEdit) => void;
}) {
	const granular =
		typeof edit.approvalPolicy === "object"
			? edit.approvalPolicy.granular
			: undefined;
	const simplePolicy =
		typeof edit.approvalPolicy === "string"
			? edit.approvalPolicy
			: "on-request";
	const policy = granular ? "granular" : simplePolicy;
	return (
		<div className="grid">
			<Field label="承認ポリシー">
				<SettingsTooltip content={approvalDescriptions[policy]}>
					<select
						className={inputStyle}
						value={policy}
						onChange={(event) =>
							onChange({
								...edit,
								approvalPolicy:
									event.target.value === "granular"
										? {
												granular:
													granularApprovalSchema.parse(
														{
															sandbox_approval: true,
															rules: true,
															skill_approval: true,
															request_permissions: true,
															mcp_elicitations: true,
														},
													),
											}
										: agentEditSchema.shape.approvalPolicy.parse(
												nonEmptyString(
													event.target.value,
												) ?? undefined,
											),
							})
						}
					>
						<option value="on-request">on-request</option>
						<option value="never">never</option>
						<option value="granular">granular</option>
						{edit.approvalPolicy === "untrusted" && (
							<option value="untrusted">
								untrusted（保存済み）
							</option>
						)}
					</select>
				</SettingsTooltip>
			</Field>
			<GranularPanel
				granular={granular}
				onChange={(value) =>
					onChange({
						...edit,
						approvalPolicy: { granular: value },
					})
				}
			/>
		</div>
	);
}

/** 閉じる間も最後の設定値を表示し、高度な設定と同じ開閉アニメーションを使う。 */
function GranularPanel({
	granular,
	onChange,
}: {
	granular: Record<keyof typeof granularLabels, boolean> | undefined;
	onChange: (value: Record<keyof typeof granularLabels, boolean>) => void;
}) {
	const [retained, setRetained] = useState(granular);
	useEffect(() => {
		if (granular) {
			setRetained(granular);
		}
	}, [granular]);
	const open = !!granular;
	const displayed = granular ?? retained;
	return (
		<div
			inert={!open}
			aria-hidden={!open}
			className={cn(
				"grid transition-[grid-template-rows] duration-[220ms]",
				"ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
				open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
			)}
		>
			<div className="min-h-0 overflow-hidden">
				<div className="pt-4">
					{displayed && (
						<GranularFields
							granular={displayed}
							onChange={onChange}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

/** 個別の要求種類は独立した真偽値として保存する。 */
function GranularFields({
	granular,
	onChange,
}: {
	granular: Record<keyof typeof granularLabels, boolean>;
	onChange: (value: Record<keyof typeof granularLabels, boolean>) => void;
}) {
	return (
		<>
			<fieldset className="grid gap-3 rounded-md border border-input-border p-3">
				<legend className="text-sm">承認要求を許可する項目</legend>
				{granularApprovalSchema.keyof().options.map((key) => (
					<SettingsTooltip key={key} content={key}>
						<label className="flex items-center gap-2 text-sm">
							<ApprovalCheckbox
								checked={granular[key]}
								onChange={(checked) =>
									onChange({
										...granular,
										[key]: checked,
									})
								}
							/>
							{granularLabels[key]}
						</label>
					</SettingsTooltip>
				))}
			</fieldset>
		</>
	);
}

/** ネイティブの操作を保ち、丸いチェック表示だけをフェードで切り替える。 */
function ApprovalCheckbox({
	checked,
	onChange,
}: {
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<span className="relative inline-flex size-5 shrink-0">
			<input
				type="checkbox"
				checked={checked}
				onChange={(event) => onChange(event.target.checked)}
				className="peer sr-only"
			/>
			<span
				aria-hidden="true"
				className={cn(
					"size-5 rounded-full border border-solid border-input-border bg-transparent",
					"peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
					"peer-disabled:opacity-50",
				)}
			/>
			<span
				aria-hidden="true"
				className={cn(
					"pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-emerald-700 text-white",
					"opacity-0 transition-opacity duration-160 ease-out peer-checked:opacity-100",
					"motion-reduce:transition-none",
				)}
			>
				<Check size={14} strokeWidth={3} />
			</span>
		</span>
	);
}

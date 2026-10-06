// 設定画面のラベルと入力部品を揃え、キーボードだけでも編集できるようにする。
import {
	isNonEmptyString,
	nonEmptyString,
} from "@nerita/shared/valuePredicates";
import type { ReactNode } from "react";
import type { ManagerModel } from "@nerita/shared/agentManager/messages";

export const inputStyle =
	"w-full min-w-0 rounded-md border border-input-border bg-input px-3 py-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50";
export const buttonStyle =
	"rounded-md border border-input-border px-3 py-2 text-sm hover:bg-settings-hover aria-pressed:border-focus aria-pressed:bg-primary aria-pressed:text-primary-text focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50";

/** ラベルをクリックしても入力へ移動できる。 */
export function Field({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<label className="grid min-w-0 gap-2 text-sm">
			<span className="font-medium">{label}</span>
			{children}
		</label>
	);
}

/** モデル一覧にない保存済みの値も表示し、利用者が変更するまで保持する。 */
export function ModelField({
	value,
	models,
	onChange,
}: {
	value?: string | undefined;
	models: ManagerModel[];
	onChange: (value: string | undefined) => void;
}) {
	return (
		<Field label="モデル">
			<select
				aria-label="モデル"
				className={inputStyle}
				value={value ?? ""}
				onChange={(event) =>
					onChange(nonEmptyString(event.target.value) ?? undefined)
				}
			>
				<option value="">未指定（バックエンドに任せる）</option>
				<ModelOptions
					value={isNonEmptyString(value) ? value : ""}
					models={models}
				/>
			</select>
		</Field>
	);
}

/** モデル設定とハンドオフ設定で、候補一覧にない保存済みの値も表示する。 */
export function ModelOptions({
	value,
	models,
}: {
	value: string;
	models: ManagerModel[];
}) {
	return (
		<>
			{value !== "" && !models.some((model) => model.value === value) && (
				<option value={value}>{value}（保存済み・未確認）</option>
			)}
			{models.map((model) => (
				<option key={model.value} value={model.value}>
					{model.name}
				</option>
			))}
		</>
	);
}

/** 推論レベルはバックエンドごとの値のまま保存する。 */
export function EffortField({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value?: string | undefined;
	options: readonly string[];
	onChange: (value: string | undefined) => void;
}) {
	return (
		<Field label={label}>
			<select
				aria-label={label}
				className={inputStyle}
				value={value ?? ""}
				onChange={(event) =>
					onChange(nonEmptyString(event.target.value) ?? undefined)
				}
			>
				<option value="">未指定</option>
				{isNonEmptyString(value) && !options.includes(value) && (
					<option value={value} disabled>
						{value}（非対応・未確認）
					</option>
				)}
				{options.map((option) => (
					<option key={option} value={option}>
						{option}
					</option>
				))}
			</select>
			{options.length === 0 && (
				<span className="text-xs text-muted">
					推論候補を確認できません。モデルの指定と一覧の再読み込みを確認してください。
				</span>
			)}
		</Field>
	);
}

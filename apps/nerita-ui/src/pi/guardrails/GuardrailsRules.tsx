// パスとコマンドのルールを、JSON と同じ設定オブジェクト上で編集する。

import {
	guardActionSchema,
	commandRuleSchema,
	pathRuleSchema,
	type GuardrailsConfig,
	type PathRule,
} from "@nerita/shared/guardrails/config";
import type { JSX } from "react";
import { cn } from "cnfast";

export const inputStyle =
	"box-border w-full min-w-0 rounded border border-input-border bg-input px-2 py-1.5 text-input-text hover:border-focus focus:outline-2 focus:outline-focus";
export const buttonStyle =
	"rounded border border-panel-border bg-input px-3 py-1.5 text-input-text hover:border-focus focus:outline-2 focus:outline-focus disabled:opacity-50";

/** 番号から色相を分散させ、入力中も変わらない淡い背景色を作る。 */
function ruleBackground(index: number): string {
	const hue = (210 + index * 137.508) % 360;
	return `color-mix(in srgb, hsl(${hue} 45% 60%) 12%, var(--nerita-editor-background))`;
}

/** 許可・確認・拒否の選択値と、変更を通知する関数。 */
type ActionProps = {
	label: string;
	className?: string;
	value: "allow" | "ask" | "deny";
	onChange: (value: "allow" | "ask" | "deny") => void;
};

/** 動作名は判定結果と同じ表記に揃える。 */
function Action({ label, className, value, onChange }: ActionProps) {
	return (
		<label className={className}>
			{label}
			<select
				className={inputStyle}
				value={value}
				onChange={(event) =>
					onChange(guardActionSchema.parse(event.target.value))
				}
			>
				<option value="deny">deny · 拒否</option>
				<option value="ask">ask · 承認</option>
				<option value="allow">allow · 許可候補</option>
			</select>
		</label>
	);
}

/** 編集中のガードレール設定と、変更を通知する関数。 */
type GuardrailsRulesProps = {
	config: GuardrailsConfig;
	onChange: (config: GuardrailsConfig) => void;
};

/** テンプレートは追加後に編集でき、既存 ID と衝突しない値を付ける。 */
export function GuardrailsRules({ config, onChange }: GuardrailsRulesProps) {
	const updatePath = (index: number, patch: Partial<PathRule>) =>
		onChange({
			...config,
			pathRules: config.pathRules.map((rule, i) =>
				i === index ? { ...rule, ...patch } : rule,
			),
		});
	const nextId = (prefix: string) => {
		const ids = new Set(
			[...config.pathRules, ...config.commandRules].map(
				(rule) => rule.id,
			),
		);
		let count = 1;
		while (ids.has(`${prefix}-${count}`)) {
			count++;
		}
		return `${prefix}-${count}`;
	};
	return (
		<div className="flex flex-col gap-5">
			<Action
				label="workspace外の読取り"
				className="flex flex-col gap-2"
				value={config.pathAccess.outsideRead}
				onChange={(outsideRead) =>
					onChange({
						...config,
						pathAccess: { ...config.pathAccess, outsideRead },
					})
				}
			/>
			<p className="m-0 text-[12px] text-muted">
				workspace外の書込みは拒否します。Shell・write/edit・拡張Toolの承認は維持します。SSHなどの組込み保護は緩和できません。
			</p>
			<PathRuleGroup
				onChange={onChange}
				config={config}
				nextId={nextId}
				updatePath={updatePath}
			/>
			<CommandRuleGroup
				onChange={onChange}
				config={config}
				nextId={nextId}
			/>
		</div>
	);
}

/** コマンドルールを含む設定と、編集・追加時の識別子生成。 */
type CommandRuleGroupProps = {
	onChange: (config: GuardrailsConfig) => void;
	config: GuardrailsConfig;
	nextId: (prefix: string) => string;
};

/** コマンドルール一覧と、未コミットの変更を破棄するコマンドを拒否する初期ルールの追加を提供する。 */
function CommandRuleGroup({ onChange, config, nextId }: CommandRuleGroupProps) {
	return (
		<details open className="guardrails-rule-group">
			<summary>コマンドのルール</summary>
			<div className="guardrails-rule-content">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<button
						className={buttonStyle}
						onClick={() =>
							onChange({
								...config,
								commandRules: [
									...config.commandRules,
									{
										id: nextId("command"),
										shell: "any",
										match: "contains",
										pattern: "git reset --hard",
										action: "deny",
										reason: "未保存の変更を破棄します。",
									},
								],
							})
						}
					>
						コマンドを追加
					</button>
				</div>
				{config.commandRules.map((rule, index) => {
					const update = (patch: Partial<typeof rule>) =>
						onChange({
							...config,
							commandRules: config.commandRules.map((item, i) =>
								i === index ? { ...item, ...patch } : item,
							),
						});
					return (
						<CommandRuleCard
							key={index}
							index={index}
							rule={rule}
							update={update}
							onChange={onChange}
							config={config}
						/>
					);
				})}
			</div>
		</details>
	);
}

/** パスルールを含む設定と、編集・追加時の識別子生成。 */
type PathRuleGroupProps = {
	onChange: (config: GuardrailsConfig) => void;
	config: GuardrailsConfig;
	nextId: (prefix: string) => string;
	updatePath: (index: number, patch: Partial<PathRule>) => void;
};

/** パスルール一覧と、秘密値を含むファイルへのアクセスを拒否する初期ルールの追加を提供する。 */
function PathRuleGroup(props: PathRuleGroupProps) {
	const { onChange, config, nextId } = props;
	return (
		<details open className="guardrails-rule-group">
			<summary>パスのルール</summary>
			<div className="guardrails-rule-content">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<button
						className={buttonStyle}
						onClick={() =>
							onChange({
								...config,
								pathRules: [
									...config.pathRules,
									{
										id: nextId("path"),
										base: "workspace",
										match: "glob",
										pattern: ".env*",
										exceptions: [".env.example"],
										operations: ["read", "write"],
										action: "deny",
										reason: "秘密値を含む可能性があります。",
									},
								],
							})
						}
					>
						パスを追加
					</button>
				</div>
				{config.pathRules.map((rule, index) => (
					<PathRuleCard
						key={index}
						index={index}
						rule={rule}
						{...props}
					/>
				))}
			</div>
		</details>
	);
}

/** 編集するコマンドルールと一覧内の位置、更新・削除の操作。 */
type CommandRuleCardProps = {
	index: number;
	rule: GuardrailsConfig["commandRules"][number];
	update: (patch: Partial<GuardrailsConfig["commandRules"][number]>) => void;
	onChange: (config: GuardrailsConfig) => void;
	config: GuardrailsConfig;
};

/** コマンドルールの各項目と削除操作をまとめる。 */
function CommandRuleCard({
	index,
	rule,
	update,
	onChange,
	config,
}: CommandRuleCardProps): JSX.Element {
	return (
		<details
			open
			key={index}
			style={{
				backgroundColor: ruleBackground(index + 3),
			}}
			className={cn(
				"guardrails-rule-card m-0 min-w-0 shrink-0 rounded border",
				"border-panel-border",
			)}
		>
			<summary className="cursor-pointer p-3 text-[13px]">
				コマンドルール {index + 1}
			</summary>
			<div className="p-3 pt-0">
				<div className={cn("grid grid-cols-1 gap-3", "sm:grid-cols-2")}>
					<label>
						ID
						<input
							className={inputStyle}
							value={rule.id}
							onChange={(event) =>
								update({
									id: event.target.value,
								})
							}
						/>
					</label>
					<Action
						label="判定"
						value={rule.action}
						onChange={(action) => update({ action })}
					/>
					<CommandRuleShell rule={rule} update={update} />
					{<CommandRulePattern rule={rule} update={update} />}
					<label className="sm:col-span-2">
						理由
						<input
							className={inputStyle}
							value={rule.reason}
							onChange={(event) =>
								update({
									reason: event.target.value,
								})
							}
						/>
					</label>
				</div>
				<button
					className={cn(buttonStyle, "mt-3")}
					onClick={() =>
						onChange({
							...config,
							commandRules: config.commandRules.filter(
								(_, i) => i !== index,
							),
						})
					}
				>
					コマンドルール {index + 1} を削除
				</button>
			</div>
		</details>
	);
}

/** コマンドルールと、適用するシェルの変更を通知する関数。 */
type CommandRuleShellProps = {
	rule: GuardrailsConfig["commandRules"][number];
	update: (patch: Partial<GuardrailsConfig["commandRules"][number]>) => void;
};

/** コマンドの判定文字列をルールへ反映する。 */
function CommandRulePattern({
	rule,
	update,
}: {
	rule: GuardrailsConfig["commandRules"][number];
	update: (patch: Partial<GuardrailsConfig["commandRules"][number]>) => void;
}) {
	return (
		<label>
			含まれる文字列
			<input
				className={inputStyle}
				value={rule.pattern}
				onChange={(event) =>
					update({
						pattern: event.target.value,
					})
				}
			/>
		</label>
	);
}

/** コマンドルールに適用するシェルを選ぶ。 */
function CommandRuleShell({ rule, update }: CommandRuleShellProps) {
	return (
		<label>
			Shell
			<select
				className={inputStyle}
				value={rule.shell}
				onChange={(event) =>
					update({
						shell: commandRuleSchema.shape.shell.parse(
							event.target.value,
						),
					})
				}
			>
				{["any", "powershell", "pwsh", "bash"].map((value) => (
					<option key={value}>{value}</option>
				))}
			</select>
		</label>
	);
}

/** 編集するパスルールと一覧内の位置、更新・削除の操作。 */
type PathRuleCardProps = {
	index: number;
	rule: PathRule;
	updatePath: (index: number, patch: Partial<PathRule>) => void;
	onChange: (config: GuardrailsConfig) => void;
	config: GuardrailsConfig;
};

/** パスルールのカードと、狭い表示幅で一列になる入力欄の配置。 */
const pathRuleCardStyle = `
     guardrails-rule-card m-0 min-w-0 shrink-0 rounded border
     border-panel-border
   `;
const pathRuleFieldsStyle = `
      grid grid-cols-1 gap-3
      sm:grid-cols-2
    `;

/** パスルールの各項目と削除操作をまとめる。 */
function PathRuleCard(props: PathRuleCardProps): JSX.Element {
	const { index, rule, updatePath, onChange, config } = props;
	return (
		<details
			open
			key={index}
			style={{ backgroundColor: ruleBackground(index) }}
			className={pathRuleCardStyle}
		>
			<summary className="cursor-pointer p-3 text-[13px]">
				パスルール {index + 1}
			</summary>
			<div className="p-3 pt-0">
				<div className={pathRuleFieldsStyle}>
					<label>
						ID
						<input
							className={inputStyle}
							value={rule.id}
							onChange={(event) =>
								updatePath(index, {
									id: event.target.value,
								})
							}
						/>
					</label>
					<Action
						label="判定"
						value={rule.action}
						onChange={(action) => updatePath(index, { action })}
					/>
					<PathRuleBase {...props} />
					<PathRuleMatch {...props} />
					<label className="sm:col-span-2">
						相対パス / パターン
						<input
							className={inputStyle}
							value={rule.pattern}
							onChange={(event) =>
								updatePath(index, {
									pattern: event.target.value,
								})
							}
						/>
					</label>
					<PathRuleExceptions {...props} />
					<PathRuleOperations {...props} />
					<label className="sm:col-span-2">
						理由
						<input
							className={inputStyle}
							value={rule.reason}
							onChange={(event) =>
								updatePath(index, {
									reason: event.target.value,
								})
							}
						/>
					</label>
				</div>
				<button
					className={cn(buttonStyle, "mt-3")}
					onClick={() =>
						onChange({
							...config,
							pathRules: config.pathRules.filter(
								(_, i) => i !== index,
							),
						})
					}
				>
					パスルール {index + 1} を削除
				</button>
			</div>
		</details>
	);
}

/** パスルールと一覧内の位置、基準ディレクトリを更新する関数。 */
type PathRuleBaseProps = Pick<
	PathRuleCardProps,
	"rule" | "index" | "updatePath"
>;

/** パスルールの基準ディレクトリを、ワークスペースまたはホームから選ぶ。 */
function PathRuleBase({ rule, updatePath, index }: PathRuleBaseProps) {
	return (
		<label>
			基準
			<select
				className={inputStyle}
				value={rule.base}
				onChange={(event) =>
					updatePath(index, {
						base: pathRuleSchema.shape.base.parse(
							event.target.value,
						),
					})
				}
			>
				<option value="workspace">workspace</option>
				<option value="home">home</option>
			</select>
		</label>
	);
}

/** パスルールと一覧内の位置、照合方式を更新する関数。 */
type PathRuleMatchProps = PathRuleBaseProps;

/** 照合方式を glob・完全一致・ディレクトリ配下から選ぶ。 */
function PathRuleMatch({ rule, updatePath, index }: PathRuleMatchProps) {
	return (
		<label>
			照合
			<select
				className={inputStyle}
				value={rule.match}
				onChange={(event) =>
					updatePath(index, {
						match: pathRuleSchema.shape.match.parse(
							event.target.value,
						),
					})
				}
			>
				<option value="glob">glob</option>
				<option value="file">ファイル完全一致</option>
				<option value="directory">ディレクトリ配下</option>
			</select>
		</label>
	);
}

/** パスルールと一覧内の位置、対象操作を更新する関数。 */
type PathRuleOperationsProps = PathRuleBaseProps;

/** 読取り・書込みの対象操作をパスルールへ反映する。 */
function PathRuleOperations({
	rule,
	updatePath,
	index,
}: PathRuleOperationsProps) {
	return (
		<div className="flex flex-wrap gap-3">
			{(["read", "write"] as const).map((operation) => (
				<label key={operation} className="flex items-center gap-1">
					<input
						type="checkbox"
						checked={rule.operations.includes(operation)}
						onChange={(event) =>
							updatePath(index, {
								operations: event.target.checked
									? [...rule.operations, operation]
									: rule.operations.filter(
											(value) => value !== operation,
										),
							})
						}
					/>
					{operation}
				</label>
			))}
		</div>
	);
}

/** パスルールと一覧内の位置、例外一覧を更新する関数。 */
type PathRuleExceptionsProps = PathRuleBaseProps;

/** パスルールの例外一覧と追加操作を表示する。 */
function PathRuleExceptions(props: PathRuleExceptionsProps) {
	const { rule, updatePath, index } = props;
	return (
		<div className={cn("flex flex-col gap-2", "sm:col-span-2")}>
			{rule.exceptions.map((exception, entry) => (
				<PathRuleException
					key={entry}
					entry={entry}
					exception={exception}
					{...props}
				/>
			))}
			<button
				className={cn(buttonStyle, "self-start")}
				onClick={() =>
					updatePath(index, {
						exceptions: [...rule.exceptions, ""],
					})
				}
			>
				例外を追加
			</button>
		</div>
	);
}

/** 編集する例外と対応するパスルール、それぞれの位置と更新操作。 */
type PathRuleExceptionProps = {
	entry: number;
	exception: string;
	updatePath: (index: number, patch: Partial<PathRule>) => void;
	index: number;
	rule: PathRule;
};

/** 例外の編集と削除を対応するルールへ反映する。 */
function PathRuleException({
	entry,
	exception,
	updatePath,
	index,
	rule,
}: PathRuleExceptionProps): JSX.Element {
	return (
		<div className="flex items-end gap-2" key={entry}>
			<label className="min-w-0 flex-1">
				例外 {entry + 1}
				<input
					className={inputStyle}
					value={exception}
					onChange={(event) =>
						updatePath(index, {
							exceptions: rule.exceptions.map((value, i) =>
								i === entry ? event.target.value : value,
							),
						})
					}
				/>
			</label>
			<button
				className={buttonStyle}
				onClick={() =>
					updatePath(index, {
						exceptions: rule.exceptions.filter(
							(_, i) => i !== entry,
						),
					})
				}
			>
				例外 {entry + 1} を削除
			</button>
		</div>
	);
}

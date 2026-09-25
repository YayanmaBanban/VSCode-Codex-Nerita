// パスとコマンドのルールを、JSON と同じ設定オブジェクト上で編集する。
import type {
	GuardrailsConfig,
	PathRule,
} from "../../../shared/guardrails/config";

export const inputStyle =
	"box-border w-full min-w-0 rounded border border-input-border bg-input px-2 py-1.5 text-input-text hover:border-focus focus:outline-2 focus:outline-focus";
export const buttonStyle =
	"rounded border border-panel-border bg-input px-3 py-1.5 text-input-text hover:border-focus focus:outline-2 focus:outline-focus disabled:opacity-50";

/** 番号から色相を分散させ、入力中も変わらない淡い背景色を作る。 */
function ruleBackground(index: number): string {
	const hue = (210 + index * 137.508) % 360;
	return `color-mix(in srgb, hsl(${hue} 45% 60%) 12%, var(--vscode-editor-background, #181818))`;
}

/** 動作名は判定結果と同じ表記に揃える。 */
function Action({
	value,
	onChange,
}: {
	value: "allow" | "ask" | "deny";
	onChange: (value: "allow" | "ask" | "deny") => void;
}) {
	return (
		<select
			className={inputStyle}
			value={value}
			onChange={(event) => onChange(event.target.value as typeof value)}
		>
			<option value="deny">deny · 拒否</option>
			<option value="ask">ask · 承認</option>
			<option value="allow">allow · 許可候補</option>
		</select>
	);
}

/** テンプレートは追加後に編集でき、既存 ID と衝突しない値を付ける。 */
export function GuardrailsRules({
	config,
	onChange,
}: {
	config: GuardrailsConfig;
	onChange: (config: GuardrailsConfig) => void;
}) {
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
			<label className="flex flex-col gap-2">
				workspace外の読取り
				<Action
					value={config.pathAccess.outsideRead}
					onChange={(outsideRead) =>
						onChange({
							...config,
							pathAccess: { ...config.pathAccess, outsideRead },
						})
					}
				/>
			</label>
			<p className="m-0 text-[12px] text-muted">
				workspace外の書込みは拒否します。Shell・write/edit・拡張Toolの承認は維持します。SSHなどの組込み保護は緩和できません。
			</p>
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
						<details
							open
							key={index}
							style={{ backgroundColor: ruleBackground(index) }}
							className="guardrails-rule-card m-0 min-w-0 shrink-0 rounded border border-panel-border"
						>
							<summary className="cursor-pointer p-3 text-[13px]">
								パスルール {index + 1}
							</summary>
							<div className="p-3 pt-0">
								<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
									<label>
										判定
										<Action
											value={rule.action}
											onChange={(action) =>
												updatePath(index, { action })
											}
										/>
									</label>
									<label>
										基準
										<select
											className={inputStyle}
											value={rule.base}
											onChange={(event) =>
												updatePath(index, {
													base: event.target
														.value as PathRule["base"],
												})
											}
										>
											<option value="workspace">
												workspace
											</option>
											<option value="home">home</option>
										</select>
									</label>
									<label>
										照合
										<select
											className={inputStyle}
											value={rule.match}
											onChange={(event) =>
												updatePath(index, {
													match: event.target
														.value as PathRule["match"],
												})
											}
										>
											<option value="glob">glob</option>
											<option value="file">
												ファイル完全一致
											</option>
											<option value="directory">
												ディレクトリ配下
											</option>
										</select>
									</label>
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
									<div className="flex flex-col gap-2 sm:col-span-2">
										{rule.exceptions.map(
											(exception, entry) => (
												<div
													className="flex items-end gap-2"
													key={entry}
												>
													<label className="min-w-0 flex-1">
														例外 {entry + 1}
														<input
															className={
																inputStyle
															}
															value={exception}
															onChange={(event) =>
																updatePath(
																	index,
																	{
																		exceptions:
																			rule.exceptions.map(
																				(
																					value,
																					i,
																				) =>
																					i ===
																					entry
																						? event
																								.target
																								.value
																						: value,
																			),
																	},
																)
															}
														/>
													</label>
													<button
														className={buttonStyle}
														onClick={() =>
															updatePath(index, {
																exceptions:
																	rule.exceptions.filter(
																		(
																			_,
																			i,
																		) =>
																			i !==
																			entry,
																	),
															})
														}
													>
														例外 {entry + 1} を削除
													</button>
												</div>
											),
										)}
										<button
											className={`${buttonStyle} self-start`}
											onClick={() =>
												updatePath(index, {
													exceptions: [
														...rule.exceptions,
														"",
													],
												})
											}
										>
											例外を追加
										</button>
									</div>
									<div className="flex flex-wrap gap-3">
										{(["read", "write"] as const).map(
											(operation) => (
												<label
													key={operation}
													className="flex items-center gap-1"
												>
													<input
														type="checkbox"
														checked={rule.operations.includes(
															operation,
														)}
														onChange={(event) =>
															updatePath(index, {
																operations:
																	event.target
																		.checked
																		? [
																				...rule.operations,
																				operation,
																			]
																		: rule.operations.filter(
																				(
																					value,
																				) =>
																					value !==
																					operation,
																			),
															})
														}
													/>
													{operation}
												</label>
											),
										)}
									</div>
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
									className={`${buttonStyle} mt-3`}
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
					))}
				</div>
			</details>
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
								commandRules: config.commandRules.map(
									(item, i) =>
										i === index
											? { ...item, ...patch }
											: item,
								),
							});
						return (
							<details
								open
								key={index}
								style={{
									backgroundColor: ruleBackground(index + 3),
								}}
								className="guardrails-rule-card m-0 min-w-0 shrink-0 rounded border border-panel-border"
							>
								<summary className="cursor-pointer p-3 text-[13px]">
									コマンドルール {index + 1}
								</summary>
								<div className="p-3 pt-0">
									<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
										<label>
											判定
											<Action
												value={rule.action}
												onChange={(action) =>
													update({ action })
												}
											/>
										</label>
										<label>
											Shell
											<select
												className={inputStyle}
												value={rule.shell}
												onChange={(event) =>
													update({
														shell: event.target
															.value as typeof rule.shell,
													})
												}
											>
												{[
													"any",
													"powershell",
													"pwsh",
													"bash",
												].map((value) => (
													<option key={value}>
														{value}
													</option>
												))}
											</select>
										</label>
										<label>
											含まれる文字列
											<input
												className={inputStyle}
												value={rule.pattern}
												onChange={(event) =>
													update({
														pattern:
															event.target.value,
													})
												}
											/>
										</label>
										<label className="sm:col-span-2">
											理由
											<input
												className={inputStyle}
												value={rule.reason}
												onChange={(event) =>
													update({
														reason: event.target
															.value,
													})
												}
											/>
										</label>
									</div>
									<button
										className={`${buttonStyle} mt-3`}
										onClick={() =>
											onChange({
												...config,
												commandRules:
													config.commandRules.filter(
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
					})}
				</div>
			</details>
		</div>
	);
}

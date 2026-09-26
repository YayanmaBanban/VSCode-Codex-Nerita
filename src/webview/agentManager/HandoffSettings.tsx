// ハンドオフの設定だけを保存し、モデル実行やセッション移行は開始しない。
import { useState } from "react";
import {
	handoffSchema,
	type HandoffConfig,
} from "../../shared/agentManager/config";
import type { ManagerState } from "../../shared/agentManager/messages";
import type { ManagerSave } from "./useAgentManager";
import { Field, EffortField, inputStyle, buttonStyle } from "./Fields";
import { HandoffModelField } from "./HandoffModelField";
import {
	effortOptions,
	handoffEffortError,
} from "../../shared/agentManager/effort";

/** fixed から current へ切り替えると、保存対象から model を除外する。 */
export function HandoffSettings({
	state,
	busy,
	save,
}: {
	state: ManagerState;
	busy: boolean;
	save: ManagerSave;
}) {
	const [config, setConfig] = useState<HandoffConfig>(state.handoff);
	const [repair, setRepair] = useState(false);
	const [error, setError] = useState<string>();
	const locked = busy || (!!state.handoffError && !repair);
	const effortError = handoffEffortError(config, state.handoff, state.models);
	return (
		<form
			className="grid gap-5"
			onSubmit={(event) => {
				event.preventDefault();
				if (effortError) {
					return;
				}
				const parsed = handoffSchema.safeParse(config);
				if (!parsed.success) {
					setError(
						"固定モデルと正の整数の timeout を指定してください。",
					);
					return;
				}
				setError(undefined);
				save({ type: "handoff", config: parsed.data });
			}}
		>
			<div>
				<h2 className="m-0 text-lg font-semibold">ハンドオフ設定</h2>
				<p className="text-sm text-muted">
					引継ぎに使うモデルを保存します。実行開始時のモデルを使う場合は
					current を選びます。
				</p>
			</div>
			{state.handoffError && (
				<div
					role="alert"
					className="grid gap-3 break-words rounded-md border border-input-border p-3 text-sm"
				>
					<span>{state.handoffError}</span>
					<button
						className={buttonStyle}
						type="button"
						disabled={busy || repair}
						onClick={() => setRepair(true)}
					>
						初期値から設定を作り直す
					</button>
				</div>
			)}
			{error && (
				<p role="alert" className="text-sm">
					{error}
				</p>
			)}
			<fieldset
				disabled={locked}
				className="m-0 grid min-w-0 gap-5 border-0 p-0"
			>
				<Field label="Timeout (ms)">
					<input
						className={inputStyle}
						type="number"
						required
						min={1}
						max={2147483647}
						step={1}
						value={config.defaults.timeoutMs || ""}
						onChange={(event) =>
							setConfig({
								...config,
								defaults: {
									timeoutMs: Number(event.target.value),
								},
							})
						}
					/>
				</Field>
				<div className="grid gap-5 lg:grid-cols-2">
					{(["pi", "codex"] as const).map((backend) => {
						const item = config.backends[backend];
						const currentOptions = effortOptions(
							state.models[backend],
							state.currentModels?.[backend],
						);
						return (
							<section
								key={backend}
								className="grid min-w-0 content-start gap-4 rounded-lg border border-input-border p-4"
								aria-label={`${backend} ハンドオフ`}
							>
								<h3 className="m-0 font-semibold">
									{backend === "pi" ? "Pi" : "Codex"}
								</h3>
								<Field label={`${backend} Strategy`}>
									<select
										className={inputStyle}
										value={item.strategy}
										onChange={(event) => {
											const { model: _model, ...rest } = {
												...item,
												model:
													"model" in item
														? item.model
														: undefined,
											};
											setConfig({
												...config,
												backends: {
													...config.backends,
													[backend]:
														event.target.value ===
														"current"
															? {
																	...rest,
																	strategy:
																		"current",
																}
															: {
																	...rest,
																	strategy:
																		"fixed",
																	model: "",
																},
												},
											});
										}}
									>
										<option value="current">
											current — 現在のセッション
										</option>
										<option value="fixed">
											fixed — 固定モデル
										</option>
									</select>
								</Field>
								{item.strategy === "fixed" && (
									<HandoffModelField
										label={`${backend} Model`}
										value={item.model}
										models={state.models[backend]}
										onChange={(model) =>
											setConfig({
												...config,
												backends: {
													...config.backends,
													[backend]: {
														...item,
														model,
													},
												},
											})
										}
									/>
								)}
								<EffortField
									label={
										backend === "pi"
											? "Thinking"
											: "Reasoning effort"
									}
									value={
										backend === "pi"
											? config.backends.pi.thinking
											: config.backends.codex
													.reasoningEffort
									}
									options={
										item.strategy === "fixed"
											? effortOptions(
													state.models[backend],
													item.model,
												)
											: currentOptions
									}
									onChange={(value) =>
										setConfig({
											...config,
											backends: {
												...config.backends,
												[backend]: {
													...item,
													[backend === "pi"
														? "thinking"
														: "reasoningEffort"]:
														value,
												},
											},
										})
									}
								/>
								{item.strategy === "current" && (
									<p className="m-0 text-xs text-muted">
										未指定なら現在のモデルに従います。推論を指定した場合は、実行時の対応確認が必要です。
									</p>
								)}
							</section>
						);
					})}
				</div>
				<button
					disabled={!!effortError}
					className={`${buttonStyle} justify-self-start`}
					type="submit"
				>
					ハンドオフ設定を保存
				</button>
				{effortError && (
					<p role="alert" className="text-sm">
						{effortError}
					</p>
				)}
			</fieldset>
			<p className="m-0 text-xs text-muted">
				保存先: .nerita/handoff.json
			</p>
			<details>
				<summary className="cursor-pointer text-sm">出力 JSON</summary>
				<pre className="overflow-auto rounded-md border border-input-border p-3 text-xs">
					{JSON.stringify(config, null, 2)}
				</pre>
			</details>
		</form>
	);
}

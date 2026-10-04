// ハンドオフの設定だけを保存し、モデル実行やセッション移行は開始しない。

import { type JSX, useState, type Dispatch, type SetStateAction } from "react";

import {
	handoffSchema,
	type HandoffConfig,
} from "@nerita/shared/agentManager/config";
import {
	effortOptions,
	handoffEffortError,
} from "@nerita/shared/agentManager/effort";
import type { ManagerState } from "@nerita/shared/agentManager/messages";
import { cn } from "cnfast";

import { buttonStyle, EffortField, Field, inputStyle } from "./Fields";
import { HandoffModelField } from "./HandoffModelField";
import type { ManagerSave } from "./useAgentManager";

/** ハンドオフ設定の管理状態と、保存操作・処理中の状態。 */
type HandoffSettingsProps = {
	state: ManagerState;
	busy: boolean;
	save: ManagerSave;
};

/** `fixed` から `current` へ切り替えると、保存対象から `model` を除外する。 */
export function HandoffSettings({ state, busy, save }: HandoffSettingsProps) {
	const [config, setConfig] = useState<HandoffConfig>(state.handoff);
	const [repair, setRepair] = useState(false);
	const [error, setError] = useState<string>();
	const locked = busy || (!!state.handoffError && !repair);
	const effortError = handoffEffortError(
		config,
		state.handoff,
		state.models,
		state.activeBackend,
	);
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
				save({
					type: "handoff",
					backend: state.activeBackend,
					config: parsed.data,
				});
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
					className={cn(
						"grid gap-3 rounded-md border border-input-border p-3 text-sm break-words",
					)}
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
			<HandoffFields
				locked={locked}
				config={config}
				setConfig={setConfig}
				state={state}
				effortError={effortError}
			/>
			<p className="m-0 text-xs text-muted">
				保存先: .nerita/handoff.json
			</p>
		</form>
	);
}

/** 編集中のハンドオフ設定、入力制限と推論設定のエラー。 */
type HandoffFieldsProps = {
	locked: boolean;
	config: HandoffConfig;
	setConfig: Dispatch<SetStateAction<HandoffConfig>>;
	state: ManagerState;
	effortError: undefined | string;
};

/** 引継ぎのタイムアウトと各バックエンドの設定をまとめる。 */
function HandoffFields(props: HandoffFieldsProps) {
	const { locked, config, setConfig, state, effortError } = props;
	return (
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
			<div className="grid gap-5">
				{[state.activeBackend].map((backend) => {
					const item = config.backends[backend];
					const currentOptions = effortOptions(
						state.models[backend],
						state.currentModels?.[backend],
					);
					return (
						<BackendHandoffSettings
							key={backend}
							backend={backend}
							item={item}
							{...props}
							currentOptions={currentOptions}
						/>
					);
				})}
			</div>
			<button
				disabled={!!effortError}
				className={cn(buttonStyle, "justify-self-start")}
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
	);
}

/** バックエンド別のハンドオフ設定、モデル候補と編集操作。 */
type BackendHandoffSettingsProps = {
	backend: "pi" | "codex";
	item:
		| {
				strategy: "fixed";
				model: string;
				thinking?:
					| "off"
					| "minimal"
					| "low"
					| "medium"
					| "high"
					| "xhigh"
					| "max"
					| undefined;
		  }
		| {
				strategy: "current";
				thinking?:
					| "off"
					| "minimal"
					| "low"
					| "medium"
					| "high"
					| "xhigh"
					| "max"
					| undefined;
		  }
		| {
				strategy: "fixed";
				model: string;
				reasoningEffort?:
					| "low"
					| "medium"
					| "high"
					| "xhigh"
					| "max"
					| "ultra"
					| undefined;
		  }
		| {
				strategy: "current";
				reasoningEffort?:
					| "low"
					| "medium"
					| "high"
					| "xhigh"
					| "max"
					| "ultra"
					| undefined;
		  };
	setConfig: Dispatch<SetStateAction<HandoffConfig>>;
	config: HandoffConfig;
	state: ManagerState;
	currentOptions: string[];
};

/** バックエンドごとに引継ぎモデルの選び方と推論を設定する。 */
function BackendHandoffSettings(
	props: BackendHandoffSettingsProps,
): JSX.Element {
	const { backend, item, setConfig, config, state, currentOptions } = props;
	return (
		<section
			key={backend}
			className={cn(
				"grid min-w-0 content-start gap-4 rounded-lg border border-input-border p-4",
			)}
			aria-label={`${backend} ハンドオフ`}
		>
			<h3 className="m-0 font-semibold">
				{backend === "pi" ? "Pi" : "Codex"}
			</h3>
			<HandoffStrategyField {...props} />
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
				label={backend === "pi" ? "Thinking" : "Reasoning effort"}
				value={
					backend === "pi"
						? config.backends.pi.thinking
						: config.backends.codex.reasoningEffort
				}
				options={
					item.strategy === "fixed"
						? effortOptions(state.models[backend], item.model)
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
									: "reasoningEffort"]: value,
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
}

/** 引き継ぐモデルの選択方式と、固定モデルの候補・編集操作。 */
type HandoffStrategyFieldProps = {
	backend: "pi" | "codex";
	item:
		| {
				strategy: "fixed";
				model: string;
				thinking?:
					| "off"
					| "minimal"
					| "low"
					| "medium"
					| "high"
					| "xhigh"
					| "max"
					| undefined;
		  }
		| {
				strategy: "current";
				thinking?:
					| "off"
					| "minimal"
					| "low"
					| "medium"
					| "high"
					| "xhigh"
					| "max"
					| undefined;
		  }
		| {
				strategy: "fixed";
				model: string;
				reasoningEffort?:
					| "low"
					| "medium"
					| "high"
					| "xhigh"
					| "max"
					| "ultra"
					| undefined;
		  }
		| {
				strategy: "current";
				reasoningEffort?:
					| "low"
					| "medium"
					| "high"
					| "xhigh"
					| "max"
					| "ultra"
					| undefined;
		  };
	setConfig: Dispatch<SetStateAction<HandoffConfig>>;
	config: HandoffConfig;
};

/** `current` へ戻すと固定モデルを保存対象から除外する。 */
function HandoffStrategyField({
	backend,
	item,
	setConfig,
	config,
}: HandoffStrategyFieldProps) {
	return (
		<Field label={`${backend} Strategy`}>
			<select
				className={inputStyle}
				value={item.strategy}
				onChange={(event) => {
					const { model: _model, ...rest } = {
						...item,
						model: "model" in item ? item.model : undefined,
					};
					setConfig({
						...config,
						backends: {
							...config.backends,
							[backend]:
								event.target.value === "current"
									? {
											...rest,
											strategy: "current",
										}
									: {
											...rest,
											strategy: "fixed",
											model: "",
										},
						},
					});
				}}
			>
				<option value="current">current — 現在のセッション</option>
				<option value="fixed">fixed — 固定モデル</option>
			</select>
		</Field>
	);
}

// モデル候補・会話単位の設定・添付を、実行の開始前に確定する。
import { modelOptions } from "./settings/modelOptions";
import type { TurnStartParams } from "./codex-app-server/v2/TurnStartParams";
import type { ModelInfo } from "./protocol/account";
import type { StartedThread } from "./protocol/turn";
import { CodexAttachments } from "./CodexAttachments";
import { isRecord } from "../../../shared/validation";
import { parseQuota, parseUsage } from "./protocol/usage";
import type { AppServerNotification } from "./protocol/rpcMessage";
import type { CollaborationMode } from "./codex-app-server/CollaborationMode";
import { type CodexConnection } from "./runtime/connection";

/** 設定は次のturnに適用し、CLIのユーザー設定ファイルを書き換えない。 */
export abstract class CodexOptions extends CodexAttachments {
	protected models: ModelInfo[] = [];
	protected turnOptions: Partial<TurnStartParams> = {};
	private initialSandbox: StartedThread["sandbox"];
	private initialTier: string | null = null;
	protected collaborationMode = "default";
	/** モデルのページを全て取得し、失敗しても基本会話を利用できるようにする。 */
	protected override async initializedThread(
		thread: StartedThread,
	): Promise<void> {
		const client = this.client!;
		const epoch = this.epoch;
		this.models = [];
		this.turnOptions = {};
		this.collaborationMode = "default";
		this.initialSandbox = thread.sandbox;
		this.initialTier = thread.serviceTier ?? null;

		try {
			let cursor: string | undefined;
			const seen = new Set<string>();
			do {
				const page = await client.listModels(cursor);
				if (epoch !== this.epoch) {
					return;
				}
				this.models.push(...page.data);
				cursor = page.nextCursor ?? undefined;
				recordModelCursor(cursor, seen);
			} while (cursor);
		} catch {
			if (epoch !== this.epoch) {
				return;
			}
			this.models = [];
		}

		this.updateOptions(
			thread.model,
			thread.reasoningEffort ?? "",
			thread.serviceTier ?? "inherit",
		);
		this.patch({ attachmentsSupported: this.supportsAttachments });

		await this.loadThreadCapabilities(client, thread, epoch);
	}
	/** 任意のスキルと利用枠を取得し、失敗しても会話を継続する。 */
	private async loadThreadCapabilities(
		client: CodexConnection,
		thread: StartedThread,
		epoch: number,
	) {
		try {
			const response = await client.listSkills?.(thread.cwd);
			if (epoch === this.epoch) {
				this.patch({ skills: response ?? [] });
			}
		} catch {
			if (epoch === this.epoch) {
				this.patch({ skills: [] });
			}
		}
		try {
			const quota = await client.readRateLimits();
			if (epoch === this.epoch) {
				this.patch({ quota });
			}
		} catch {
			/* APIキーや独自プロバイダーには利用枠がない場合がある。 */
		}
	}

	/** 選択モデルに合わせて推論量と速度の候補を組み直す。 */
	private updateOptions(model: string, effort: string, tier: string): void {
		this.patch({
			configOptions: modelOptions(
				this.models,
				model,
				effort,
				tier,
				this.initialTier,
				this.state.configOptions.find((item) => item.id === "mode")
					?.currentValue ?? "inherit",
				this.collaborationMode,
			),
		});
	}
	/** 提示した候補だけを次のturnへ渡し、実行中の変更を禁止する。 */
	protected async setConfig(id: string, value: string): Promise<void> {
		if (this.invalidSetting(id, value)) {
			throw new Error("Invalid setting");
		}
		if (id === "model") {
			return this.selectModel(value);
		}
		if (id === "reasoning_effort") {
			this.turnOptions.effort = value;
		}
		if (id === "collaboration_mode") {
			// Goal選択ではRPCを送らず、Defaultへの切替だけ即時にthreadへ反映する。
			await this.setCollaborationMode(value);
		}
		if (id === "fast-mode") {
			await this.setConfig(
				"service_tier",
				value === "on" ? "priority" : "default",
			);
			return;
		}
		if (id === "service_tier") {
			if (value === "inherit") {
				delete this.turnOptions.serviceTierForTurn;
			} else {
				this.turnOptions.serviceTierForTurn = value;
			}
		}
		if (id === "mode") {
			this.setSandboxMode(value);
		}
		this.patch({
			configOptions: this.state.configOptions.map((item) => {
				if (item.id === id) {
					return { ...item, currentValue: value };
				}
				if (item.id === "fast-mode" && id === "service_tier") {
					return {
						...item,
						currentValue:
							(value === "inherit" ? this.initialTier : value) ===
							"priority"
								? "on"
								: "off",
					};
				}
				return item;
			}),
		});
	}
	/** 提示済みの選択肢と設定変更可能な状態を照合する。 */
	private invalidSetting(id: string, value: string) {
		return (
			this.busy() ||
			this.state.configPending ||
			!this.state.configOptions
				.find((item) => item.id === id)
				?.options.some((choice) => choice.value === value)
		);
	}

	/** 初期sandboxへの復元と明示モードへの変更を処理する。 */
	private setSandboxMode(value: string) {
		if (value === "inherit") {
			if (!this.initialSandbox) {
				throw new Error("Initial sandbox unavailable");
			}
			this.turnOptions.sandboxPolicy = this.initialSandbox;
		} else {
			this.turnOptions.sandboxPolicy = sandboxPolicy(value);
		}
	}

	/** 必要なモード変更をサーバーへ反映してから状態を更新する。 */
	private async setCollaborationMode(value: string) {
		if (value === "default" && this.collaborationMode !== "default") {
			const epoch = this.epoch;
			const sessionId = this.state.sessionId;
			if (!this.client || !sessionId) {
				throw new Error("Disconnected");
			}
			this.patch({ configPending: true });
			try {
				await this.client.updateCollaborationMode(
					sessionId,
					this.collaborationSettings("default"),
				);
				if (
					epoch !== this.epoch ||
					sessionId !== this.state.sessionId
				) {
					throw new Error("Thread changed");
				}
			} finally {
				if (
					epoch === this.epoch &&
					sessionId === this.state.sessionId
				) {
					this.patch({ configPending: false });
				}
			}
		}
		this.collaborationMode = value;
	}

	/** 対応する推論量を引き継いでモデルを変更する。 */
	private selectModel(value: string) {
		const model = this.models.find((item) => item.model === value)!;
		const previousEffort = this.state.configOptions.find(
			(item) => item.id === "reasoning_effort",
		)?.currentValue;
		// 対応する推論量は引き継ぎ、非対応の値だけ切替先の既定値へ戻す。
		const effort =
			model.supportedReasoningEfforts.find(
				(item) => item.reasoningEffort === previousEffort,
			)?.reasoningEffort ?? model.defaultReasoningEffort;
		this.turnOptions.model = value;
		this.turnOptions.effort = effort;
		delete this.turnOptions.serviceTierForTurn;
		this.updateOptions(value, effort, "inherit");
		return;
	}

	/** モードによる上書きにも、送信時点のモデルと推論量を使用する。 */
	protected collaborationSettings(
		mode = this.collaborationMode,
	): CollaborationMode {
		const model = this.state.configOptions.find(
			(item) => item.id === "model",
		)?.currentValue;
		if (!model) {
			throw new Error("Model unavailable");
		}
		return {
			mode: mode === "plan" ? "plan" : "default",
			settings: {
				model,
				reasoning_effort:
					this.state.configOptions.find(
						(item) => item.id === "reasoning_effort",
					)?.currentValue || null,
				developer_instructions: null,
			},
		};
	}
	/** 会話単位の使用量とアカウント単位の利用枠を分ける。 */
	protected override notification(message: AppServerNotification): void {
		const p = message.params;
		if (!isRecord(p)) {
			return;
		}
		if (message.method === "account/rateLimits/updated") {
			this.patch({ quota: parseQuota(p.rateLimits) });
		}
		if (
			message.method === "thread/tokenUsage/updated" &&
			p.threadId === this.state.sessionId
		) {
			this.patch({ usage: parseUsage(p.tokenUsage) });
		}
	}
}

/** モデル一覧のカーソル循環を拒否する。 */
function recordModelCursor(cursor: string | undefined, seen: Set<string>) {
	if (cursor && seen.has(cursor)) {
		throw new Error("Repeated model cursor");
	}
	if (cursor) {
		seen.add(cursor);
	}
}

/** 権限モードから次のターンのサンドボックス設定を作る。 */
function sandboxPolicy(
	value: string,
): NonNullable<TurnStartParams["sandboxPolicy"]> {
	if (value === "read-only") {
		return { type: "readOnly", networkAccess: false };
	}
	if (value === "workspace-write") {
		return {
			type: "workspaceWrite",
			writableRoots: [],
			networkAccess: false,
			excludeTmpdirEnvVar: false,
			excludeSlashTmp: false,
		};
	}
	return { type: "dangerFullAccess" };
}

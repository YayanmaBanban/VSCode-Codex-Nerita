// モデル候補・会話単位の設定・添付を、実行の開始前に確定する。
import { modelOptions } from "./settings/modelOptions";
import type { TurnStartParams } from "../../../codex-app-server/v2/TurnStartParams";
import type { ModelInfo } from "./protocol/account";
import type { StartedThread } from "./protocol/turn";
import { CodexAttachments } from "./CodexAttachments";
import { isRecord } from "../../../shared/validation";
import { parseQuota, parseUsage } from "./protocol/usage";
import type { AppServerNotification } from "./protocol/rpcMessage";

/** 設定は次のturnに適用し、CLIのユーザー設定ファイルを書き換えない。 */
export abstract class CodexOptions extends CodexAttachments {
	protected models: ModelInfo[] = [];
	protected turnOptions: Partial<TurnStartParams> = {};
	private initialSandbox: StartedThread["sandbox"];
	private initialTier: string | null = null;
	/** モデルのページを全て取得し、失敗しても基本会話を利用できるようにする。 */
	protected override async initializedThread(
		thread: StartedThread,
	): Promise<void> {
		const client = this.client!;
		const epoch = this.epoch;
		this.models = [];
		this.turnOptions = {};
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
				if (cursor && seen.has(cursor)) {
					throw new Error("Repeated model cursor");
				}
				if (cursor) {
					seen.add(cursor);
				}
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
			),
		});
	}
	/** 提示した候補だけを次のturnへ渡し、実行中の変更を禁止する。 */
	protected setConfig(id: string, value: string): void {
		if (
			this.busy() ||
			!this.state.configOptions
				.find((item) => item.id === id)
				?.options.some((choice) => choice.value === value)
		) {
			throw new Error("Invalid setting");
		}
		if (id === "model") {
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
		if (id === "reasoning_effort") {
			this.turnOptions.effort = value;
		}
		if (id === "fast-mode") {
			this.setConfig(
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
			if (value === "inherit") {
				if (!this.initialSandbox) {
					throw new Error("Initial sandbox unavailable");
				}
				this.turnOptions.sandboxPolicy = this.initialSandbox;
			} else {
				this.turnOptions.sandboxPolicy =
					value === "read-only"
						? { type: "readOnly", networkAccess: false }
						: value === "workspace-write"
							? {
									type: "workspaceWrite",
									writableRoots: [],
									networkAccess: false,
									excludeTmpdirEnvVar: false,
									excludeSlashTmp: false,
								}
							: { type: "dangerFullAccess" };
			}
		}
		this.patch({
			configOptions: this.state.configOptions.map((item) =>
				item.id === id
					? { ...item, currentValue: value }
					: item.id === "fast-mode" && id === "service_tier"
						? {
								...item,
								currentValue:
									(value === "inherit"
										? this.initialTier
										: value) === "priority"
										? "on"
										: "off",
							}
						: item,
			),
		});
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

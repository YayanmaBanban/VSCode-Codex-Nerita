// モデル候補と会話単位の実効設定を管理し、次のターンに渡す設定を確定する。
import type { ChatState } from "@nerita/shared/chatState";
import {
	isNonEmptyString,
	nonEmptyString,
} from "@nerita/shared/valuePredicates";
import { modelOptions } from "./settings/modelOptions";
import type { TurnStartParams } from "./codex-app-server/v2/TurnStartParams";
import type { ModelInfo } from "./protocol/account";
import { parseThreadPermissions, type StartedThread } from "./protocol/turn";
import { isRecord } from "@nerita/shared/validation";
import { parseQuota, parseUsage } from "./protocol/usage";
import type { AppServerNotification } from "./protocol/rpcMessage";
import type { CollaborationMode } from "./codex-app-server/CollaborationMode";
import type { CodexConnection } from "./runtime/connection";
import {
	resolveCodexSelection,
	modelReasoning,
	type CodexModelSelection,
	type CodexSelectionStore,
} from "./settings/modelSelection";

/** Plan から新規会話へ移す、モデルと権限の実効設定。 */
type PlanSettings = {
	model: string;
	effort: string;
	mode: string;
	sandboxPolicy: TurnStartParams["sandboxPolicy"];
	approvalsReviewer: TurnStartParams["approvalsReviewer"];
};

/** 会話状態と接続はコントローラー経由で参照し、設定側に別の状態・接続を持たせない。 */
type OptionsSession = {
	snapshot: () => Readonly<ChatState>;
	connection: () => CodexConnection | undefined;
	epoch: () => number;
	busy: () => boolean;
	patch: (change: Partial<ChatState>) => void;
};

/** 会話設定から上書きする項目だけを保持し、入力や送信先を所有しない。 */
type TurnOptions = Pick<
	TurnStartParams,
	| "model"
	| "effort"
	| "approvalsReviewer"
	| "sandboxPolicy"
	| "serviceTierForTurn"
>;

/** 設定は次のターンに適用し、CLI のユーザー設定ファイルを書き換えない。 */
export class CodexOptions {
	constructor(
		private readonly session: OptionsSession,
		private readonly selectionStore?: CodexSelectionStore,
	) {}

	/** App Server が返すモデル別の対応推論量を管理画面へ公開する。 */
	agentModels() {
		return this.models.map((model) => ({
			value: model.model,
			name: model.displayName,
			efforts: model.supportedReasoningEfforts.map(
				(item) => item.reasoningEffort,
			),
		}));
	}
	private models: ModelInfo[] = [];
	private turnOptions: TurnOptions = {};
	private initialSandbox: StartedThread["sandbox"];
	private initialTier: string | null = null;
	private collaborationMode = "default";
	get mode(): string {
		return this.collaborationMode;
	}
	/** ハンドオフと添付の画像対応の判定にも、次の送信と同じ選択モデルを使う。 */
	get model(): string {
		return (
			this.turnOptions.model ??
			this.session
				.snapshot()
				.configOptions.find((item) => item.id === "model")
				?.currentValue ??
			""
		);
	}
	get supportsImages(): boolean {
		return (
			this.models
				.find((item) => item.model === this.model)
				?.inputModalities.includes("image") ?? false
		);
	}
	/** 内部の可変設定を公開せず、送信時点のモデル・権限・協調モードを渡す。 */
	turnSettings(): TurnOptions & { collaborationMode: CollaborationMode } {
		return {
			...structuredClone(this.turnOptions),
			collaborationMode: this.collaborationSettings(),
		};
	}
	/** 新規会話で初期化される設定を、Plan 会話から退避する。 */
	capturePlanSettings(): PlanSettings {
		const selected = (id: string) =>
			this.session.snapshot().configOptions.find((item) => item.id === id)
				?.currentValue;
		const model = selected("model");
		if (!isNonEmptyString(model)) {
			throw new Error("Model unavailable");
		}
		return structuredClone({
			model,
			effort: selected("reasoning_effort") ?? "",
			mode: selected("mode") ?? "",
			approvalsReviewer: this.turnOptions.approvalsReviewer,
			sandboxPolicy:
				this.turnOptions.sandboxPolicy ?? this.initialSandbox,
		});
	}

	/** 新しい会話の候補を検証し、最初のターンより前に設定を復元する。 */
	async restorePlanSettings(settings: PlanSettings): Promise<void> {
		if (
			settings.approvalsReviewer !== undefined &&
			settings.approvalsReviewer !== null
		) {
			this.turnOptions.approvalsReviewer = settings.approvalsReviewer;
		}
		await this.setConfig("model", settings.model);
		if (settings.effort !== "") {
			await this.setConfig("reasoning_effort", settings.effort);
		}
		if (settings.mode !== "") {
			await this.setConfig("mode", settings.mode);
		}
		if (settings.sandboxPolicy) {
			// 書き込み先やネットワーク設定も元の会話と同じ状態に保つ。
			this.turnOptions.sandboxPolicy = settings.sandboxPolicy;
		}
	}
	/** 会話の切り替え後、操作待ちを維持したまま呼ぶ。モデル候補の取得に失敗しても会話を継続する。 */
	async initialize(
		thread: StartedThread,
		restoreSelection = true,
	): Promise<void> {
		const client = this.session.connection()!;
		const epoch = this.session.epoch();
		this.models = [];
		this.turnOptions = {
			approvalsReviewer: thread.approvalsReviewer ?? "user",
		};
		this.collaborationMode = "default";
		this.initialSandbox = thread.sandbox;
		this.initialTier = thread.serviceTier ?? null;

		try {
			let cursor: string | undefined;
			const seen = new Set<string>();
			do {
				const page = await client.listModels(cursor);
				if (epoch !== this.session.epoch()) {
					return;
				}
				this.models.push(...page.data);
				cursor = page.nextCursor ?? undefined;
				recordModelCursor(cursor, seen);
			} while (isNonEmptyString(cursor));
		} catch {
			if (epoch !== this.session.epoch()) {
				return;
			}
			this.models = [];
		}

		const saved = await this.savedSelection(restoreSelection);
		if (epoch !== this.session.epoch()) {
			return;
		}
		this.applyInitialSelection(thread, saved);
		await this.loadThreadCapabilities(client, thread, epoch);
	}

	/** 新規会話の場合だけ保存先から設定を読み込む。 */
	private async savedSelection(restore: boolean) {
		return restore ? await this.selectionStore?.read() : undefined;
	}
	/** モデル候補で検証した保存値を、送信設定と表示に反映する。 */
	private applyInitialSelection(
		thread: StartedThread,
		saved: CodexModelSelection | undefined,
	): void {
		const selection = resolveCodexSelection(
			saved,
			this.models,
			thread.model,
		);
		if (selection) {
			this.turnOptions.model = selection.model;
			this.turnOptions.effort = selection.reasoning;
		}
		this.updateOptions(
			selection?.model ?? thread.model,
			selection?.reasoning ?? thread.reasoningEffort ?? "",
			thread.serviceTier ?? "inherit",
		);
	}

	/** UI で確定したモデル・推論だけを保存し、履歴復元では上書きしない。 */
	async rememberSelection(id: string): Promise<void> {
		if (id !== "model" && id !== "reasoning_effort") {
			return;
		}
		const model = this.session
			.snapshot()
			.configOptions.find((item) => item.id === "model")?.currentValue;
		const reasoning =
			this.session
				.snapshot()
				.configOptions.find((item) => item.id === "reasoning_effort")
				?.currentValue ?? "";
		if (isNonEmptyString(model)) {
			await this.selectionStore?.write({ model, reasoning });
		}
	}
	/** 任意のスキルと利用枠を取得し、失敗しても会話を継続する。 */
	private async loadThreadCapabilities(
		client: CodexConnection,
		thread: StartedThread,
		epoch: number,
	) {
		try {
			const response = await client.listSkills?.(thread.cwd);
			if (epoch === this.session.epoch()) {
				this.session.patch({ skills: response ?? [] });
			}
		} catch {
			if (epoch === this.session.epoch()) {
				this.session.patch({ skills: [] });
			}
		}
		try {
			const quota = await client.readRateLimits();
			if (epoch === this.session.epoch()) {
				this.session.patch({ quota });
			}
		} catch {
			/* API キーや独自プロバイダーでは利用枠を取得できない場合がある。 */
		}
	}

	/** 選択モデルに合わせて推論量と速度の候補を組み直す。 */
	private updateOptions(model: string, effort: string, tier: string): void {
		this.session.patch({
			configOptions: modelOptions(
				this.models,
				model,
				effort,
				tier,
				this.initialTier,
				sandboxMode(
					this.turnOptions.sandboxPolicy ?? this.initialSandbox,
				),
				this.collaborationMode,
				this.turnOptions.approvalsReviewer ?? "user",
			),
		});
	}
	/** 提示した候補だけを次のターンへ渡し、実行中の変更を禁止する。 */
	async setConfig(id: string, value: string): Promise<void> {
		if (this.invalidSetting(id, value)) {
			throw new Error("Invalid setting");
		}
		if (id === "model") {
			this.selectModel(value);
			return;
		}
		if (id === "reasoning_effort") {
			this.turnOptions.effort = value;
		}
		if (id === "collaboration_mode") {
			// `Goal` 選択では RPC を送らず、`Default` への切替だけ即時にスレッドへ反映する。
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
			this.setServiceTier(value);
		}
		if (id === "mode") {
			this.setSandboxMode(value);
		}
		if (id === "approvals_reviewer") {
			this.turnOptions.approvalsReviewer = reviewerValue(value);
		}
		this.session.patch({
			configOptions: this.session.snapshot().configOptions.map((item) => {
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
	/** 継承を選んだときだけターン単位の速度指定を外す。 */
	private setServiceTier(value: string) {
		if (value === "inherit") {
			delete this.turnOptions.serviceTierForTurn;
		} else {
			this.turnOptions.serviceTierForTurn = value;
		}
	}
	/** 提示済みの選択肢と設定変更可能な状態を照合する。 */
	private invalidSetting(id: string, value: string) {
		return (
			this.session.busy() ||
			this.session.snapshot().configPending ||
			!(
				this.session
					.snapshot()
					.configOptions.find((item) => item.id === id)
					?.options.some((choice) => choice.value === value) === true
			)
		);
	}

	/** 初期モードへ戻すときは書き込み先などの詳細設定も維持する。 */
	private setSandboxMode(value: string) {
		if (this.initialSandbox && value === sandboxMode(this.initialSandbox)) {
			this.turnOptions.sandboxPolicy = this.initialSandbox;
		} else {
			this.turnOptions.sandboxPolicy = sandboxPolicy(value);
		}
	}

	/** 必要なモード変更をサーバーへ反映してから状態を更新する。 */
	private async setCollaborationMode(value: string) {
		if (value === "default" && this.collaborationMode !== "default") {
			const epoch = this.session.epoch();
			const sessionId = this.session.snapshot().sessionId;
			const client = this.session.connection();
			if (!client || !isNonEmptyString(sessionId)) {
				throw new Error("Disconnected");
			}
			this.session.patch({ configPending: true });
			try {
				await client.updateCollaborationMode(
					sessionId,
					this.collaborationSettings("default"),
				);
				if (
					epoch !== this.session.epoch() ||
					sessionId !== this.session.snapshot().sessionId
				) {
					throw new Error("Thread changed");
				}
			} finally {
				if (
					epoch === this.session.epoch() &&
					sessionId === this.session.snapshot().sessionId
				) {
					this.session.patch({ configPending: false });
				}
			}
		}
		this.collaborationMode = value;
	}

	/** 対応する推論量を引き継いでモデルを変更する。 */
	private selectModel(value: string) {
		const model = this.models.find((item) => item.model === value)!;
		const previousEffort = this.session
			.snapshot()
			.configOptions.find(
				(item) => item.id === "reasoning_effort",
			)?.currentValue;
		const effort = modelReasoning(model, previousEffort);
		this.turnOptions.model = value;
		this.turnOptions.effort = effort;
		delete this.turnOptions.serviceTierForTurn;
		this.updateOptions(value, effort, "inherit");
		return;
	}

	/** モードによる上書きにも、送信時点のモデルと推論量を使用する。 */
	private collaborationSettings(
		mode = this.collaborationMode,
	): CollaborationMode {
		const model = this.session
			.snapshot()
			.configOptions.find((item) => item.id === "model")?.currentValue;
		if (!isNonEmptyString(model)) {
			throw new Error("Model unavailable");
		}
		return {
			mode: mode === "plan" ? "plan" : "default",
			settings: {
				model,
				reasoning_effort:
					nonEmptyString(
						this.session
							.snapshot()
							.configOptions.find(
								(item) => item.id === "reasoning_effort",
							)?.currentValue,
					) ?? null,
				developer_instructions: null,
			},
		};
	}
	/** 会話単位の使用量とアカウント単位の利用枠を分ける。 */
	notification(message: AppServerNotification): void {
		const p = message.params;
		if (!isRecord(p)) {
			return;
		}
		if (
			message.method === "thread/settings/updated" &&
			p.threadId === this.session.snapshot().sessionId
		) {
			this.applyThreadPermissions(p.threadSettings);
		}
		if (message.method === "account/rateLimits/updated") {
			this.session.patch({ quota: parseQuota(p.rateLimits) });
		}
		if (
			message.method === "thread/tokenUsage/updated" &&
			p.threadId === this.session.snapshot().sessionId
		) {
			this.session.patch({ usage: parseUsage(p.tokenUsage) });
		}
	}

	/** サーバーの確定値を表示と次のターンへ反映し、古い権限の上書きを残さない。 */
	private applyThreadPermissions(value: unknown): void {
		const settings = parseThreadPermissions(value);
		this.initialSandbox = settings.sandboxPolicy;
		delete this.turnOptions.sandboxPolicy;
		this.turnOptions.approvalsReviewer = settings.approvalsReviewer;
		this.session.patch({
			configOptions: this.session
				.snapshot()
				.configOptions.map((option) => {
					if (option.id === "mode") {
						return {
							...option,
							currentValue: sandboxMode(settings.sandboxPolicy),
						};
					}
					if (option.id === "approvals_reviewer") {
						return {
							...option,
							currentValue: settings.approvalsReviewer,
						};
					}
					return option;
				}),
		});
	}
}

/** 選択候補の検証に加え、対応する承認者の値だけを返す。 */
function reviewerValue(
	value: string,
): NonNullable<TurnStartParams["approvalsReviewer"]> {
	if (value === "user" || value === "auto_review") {
		return value;
	}
	throw new Error("Invalid approvals reviewer");
}

/** モデル一覧のカーソル循環を拒否する。 */
function recordModelCursor(cursor: string | undefined, seen: Set<string>) {
	if (isNonEmptyString(cursor) && seen.has(cursor)) {
		throw new Error("Repeated model cursor");
	}
	if (isNonEmptyString(cursor)) {
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
	if (value === "danger-full-access") {
		return { type: "dangerFullAccess" };
	}
	throw new Error("Invalid sandbox mode");
}

/** サーバーの実効サンドボックスを UI の選択値へ対応付ける。 */
function sandboxMode(policy: TurnStartParams["sandboxPolicy"]): string {
	switch (policy?.type) {
		case "readOnly":
			return "read-only";
		case "workspaceWrite":
			return "workspace-write";
		case "dangerFullAccess":
			return "danger-full-access";
		case undefined:
		case "externalSandbox":
			return "";
	}
}

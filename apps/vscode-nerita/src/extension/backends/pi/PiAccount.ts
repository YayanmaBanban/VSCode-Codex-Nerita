// 認証の秘密値を Host 内に留め、モデル選択と公開状態をまとめる。

import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { ChatState } from "@nerita/shared/chatState";
import type { PiAuthItem } from "@nerita/shared/piAuth";
import { PiProviderControls } from "./PiProviderControls";
import { piModelOptions } from "./PiModelOptions";
import { PiModelCatalogService } from "./PiModelCatalogService";
import type { PiModelSelection } from "./PiRuntime";
import { piAgentModel } from "./PiAgentModels";
import type { PiCredentialStore } from "../../credentials/PiCredentialStore";
import { credentialStorageModeSchema } from "@nerita/shared/credentials";

/** SDK の認証対話を VS Code とテストで差し替える。 */
export type PiAuthService = {
	manage: (
		items: () => Promise<PiAuthItem[]>,
		execute: (id: string, signal: AbortSignal) => Promise<void>,
		signal: AbortSignal,
	) => Promise<void>;
	interaction(signal: AbortSignal): Parameters<ModelRuntime["login"]>[2];
};

/** 接続中の会話を維持して認証・モデル設定を変更する。 */
export class PiAccount {
	/** 管理画面では親とは異なるプロバイダーのモデルも選択できる。 */
	agentModels() {
		return this.catalog
			.available()
			.map((model) =>
				piAgentModel(
					model,
					this.supportedThinking?.(model),
					this.catalog.metadata(model.provider, model.id),
				),
			);
	}
	constructor(
		private models: ModelRuntime,
		private session: AgentSession,
		private service?: PiAuthService,
		readonly controls = new PiProviderControls(),
		readonly catalog = new PiModelCatalogService(models, session),
		private saveModel?: (selection: PiModelSelection) => Promise<void>,
		private initialSelection?: PiModelSelection,
		private supportedThinking?: (
			model: NonNullable<AgentSession["model"]>,
		) => string[],
		private deviceId?: () => Promise<string>,
		private credentials?: PiCredentialStore,
	) {
		controls.bind(session);
		controls.bindCatalog((provider) => catalog.snapshot(provider));
	}

	/** カタログの更新後は利用可能なモデルへ復帰し、選択不能な履歴モデルを残さない。 */
	async refreshCatalog(signal: AbortSignal): Promise<void> {
		const provider = this.session.model?.provider;
		if (provider && this.catalog.snapshot(provider) !== undefined) {
			await this.catalog.refresh(provider, signal);
		}
		signal.throwIfAborted();
		if (provider) {
			await this.reconcileModel(signal);
		}
		this.restoreReasoning(signal);
		this.controls.snapshot();
	}

	/** 起動時に保存済みの推論レベルを一度だけ適用し、使えない値は現在の候補から選び直す。 */
	private restoreReasoning(signal: AbortSignal): void {
		const saved = this.initialSelection;
		this.initialSelection = undefined;
		if (!saved?.reasoning) {
			return;
		}
		const options = this.controls.reasoningOptions;
		const current = this.controls.snapshot();
		const requested =
			saved.provider === current.provider &&
			saved.model === current.modelId
				? saved.reasoning
				: current.effectiveReasoning;
		const value = [
			requested,
			current.effectiveReasoning,
			"medium",
			...options.map((option) => option.value),
		].find((candidate) =>
			options.some((option) => option.value === candidate),
		);
		if (value) {
			this.controls.selectReasoning(value, signal);
		}
	}

	/** キー、トークン、SDK の認証結果そのものは公開しない。 */
	snapshot(): Partial<ChatState> {
		const model = this.session.model;
		const controls = this.controls.snapshot();
		const available = this.catalog.available(
			this.models.getAvailableSnapshot(),
		);
		const status = model
			? this.models.getProviderAuthStatus(model.provider)
			: undefined;
		return {
			piProviderControls: controls,
			connection:
				model &&
				available.some(
					(item) =>
						item.provider === model.provider &&
						item.id === model.id,
				)
					? "ready"
					: "auth-required",
			authMethods: [{ id: "pi", name: "認証情報を設定" }],
			piAccount: model
				? `${model.provider}: ${authStatusLabel(this.models, model.provider, status?.configured)}`
				: "Pi: モデル・認証未設定",
			configOptions: piModelOptions(
				this.session,
				this.controls,
				available,
				this.catalog,
			),
		};
	}

	/** 表示済みの候補で切り替え、操作の完了をモデル一覧の外部再取得で待たせない。 */
	async selectModel(value: string, signal: AbortSignal): Promise<void> {
		const available = this.models.getAvailableSnapshot();
		const model = this.catalog
			.available(available)
			.find((item) => `${item.provider}/${item.id}` === value);
		if (!model) {
			throw new Error("利用可能なPiモデルを選択してください。");
		}
		signal.throwIfAborted();
		await this.session.setModel(model);
		await this.rememberModel(model.provider, model.id);
		this.controls.snapshot();
	}

	/** プロバイダーを変更する際は、利用可能なモデルを選択して保存する。 */
	async selectProvider(value: string, signal: AbortSignal): Promise<void> {
		const available = await this.models.getAvailable(undefined, { signal });
		await this.catalog.refresh(value, signal);
		const model = this.catalog
			.available(available)
			.find((item) => item.provider === value);
		if (!model) {
			throw new Error("利用可能なPi providerを選択してください。");
		}
		signal.throwIfAborted();
		if (
			this.session.model?.provider === value &&
			this.catalog
				.available(available)
				.some(
					(item) =>
						item.provider === value &&
						item.id === this.session.model?.id,
				)
		) {
			return;
		}
		await this.session.setModel(model);
		await this.rememberModel(model.provider, model.id);
		this.controls.snapshot();
	}

	/** 現在のモデルが対応する推論レベルだけを SDK へ渡す。 */
	selectThinkingLevel(value: string, signal: AbortSignal): Promise<void> {
		this.controls.selectReasoning(value, signal);
		const model = this.session.model;
		return model
			? this.rememberModel(model.provider, model.id)
			: Promise.resolve();
	}

	/** 設定 ID に応じてモデル関連の変更を処理し、その他は共通の設定処理へ渡す。 */
	async configure(
		id: string,
		value: string,
		signal: AbortSignal,
	): Promise<void> {
		if (id === "provider") {
			await this.selectProvider(value, signal);
		} else if (id === "model") {
			await this.selectModel(value, signal);
		} else if (id === "reasoning_effort") {
			await this.selectThinkingLevel(value, signal);
		} else {
			this.controls.configure(id, value, signal);
		}
	}

	/** 認証の管理操作は一覧で提示した ID だけを受け付ける。 */
	async authenticate(_logout: boolean, signal: AbortSignal): Promise<void> {
		if (!this.service) {
			throw new Error("Piの認証画面が接続されていません。");
		}
		await this.service.manage(
			() => this.items(signal),
			(id, operationSignal) =>
				this.executeAuthOperation(id, operationSignal),
			signal,
		);
		if (!signal.aborted) {
			await this.reconcileModel(signal);
		}
	}

	/** アカウントの選択と削除にも、モデル・カタログの再同期を適用する。 */
	private async executeAuthOperation(id: string, signal: AbortSignal) {
		if (!supportsAuthOperation(await this.items(signal), id)) {
			throw new Error("未対応の認証操作です。");
		}
		const [provider, type, accountId] = JSON.parse(id) as [
			string,
			"api_key" | "oauth" | "logout" | "select" | "delete",
			string?,
		];
		this.catalog.invalidate();
		if (type === "select" || type === "delete") {
			if (!this.credentials || !accountId) {
				throw new Error("認証アカウントが指定されていません。");
			}
			if (type === "select") {
				await this.credentials.vault.select(provider, accountId);
			} else {
				await this.credentials.vault.remove(
					this.credentials.vault
						.list(provider)
						.find((account) => account.id === accountId),
					{ signal },
				);
			}
			await this.models.refresh({ signal });
		} else if (type === "logout") {
			await this.models.logout(provider, { signal });
		} else {
			await this.loginAccount(provider, type, signal);
		}
		signal.throwIfAborted();
		await this.catalog.refresh(provider, signal);
		await this.reconcileModel(signal, provider);
	}

	/** 新規ログインでは既存アカウントを上書きせず、保存先を対話で確定する。 */
	private async loginAccount(
		provider: string,
		type: "api_key" | "oauth",
		signal: AbortSignal,
	) {
		const deviceId =
			type === "oauth" && provider === "openai"
				? await this.deviceId?.()
				: undefined;
		const interaction = this.authInteraction(signal);
		const login = () =>
			this.models.login(
				provider,
				type,
				interaction,
				deviceId ? { getDeviceId: () => deviceId } : undefined,
			);
		if (!this.credentials) {
			await login();
			return;
		}
		const mode = credentialStorageModeSchema.parse(
			await interaction.prompt({
				type: "select",
				message: "保存方法",
				options: [
					{ id: "session", label: "このセッションのみ" },
					{ id: "secret-storage", label: "VS Code に保存" },
				],
			}),
		);
		const name = await interaction.prompt({
			type: "text",
			message: "アカウント名（秘密情報は入力しないでください）",
		});
		signal.throwIfAborted();
		await this.credentials.login(provider, type, mode, name, login);
	}

	/** 認証対話で入力した秘密値を、SDK の通知を公開する前に出力保護へ登録する。 */
	private authInteraction(
		signal: AbortSignal,
	): ReturnType<PiAuthService["interaction"]> {
		const interaction = this.service!.interaction(signal);
		const redactor = this.credentials?.vault.stores.redactor;
		return {
			...interaction,
			prompt: async (prompt) => {
				const value = await interaction.prompt(prompt);
				if (prompt.type === "secret" || prompt.type === "manual_code") {
					redactor?.protect(value);
				}
				return value;
			},
			notify: (event) =>
				interaction.notify(redactor?.value(event) ?? event),
		};
	}

	/** 認証切れの旧モデルを保持せず、Pi の利用可能候補へ復帰する。 */
	private async reconcileModel(
		signal: AbortSignal,
		provider?: string,
	): Promise<void> {
		const available = await this.models.getAvailable(undefined, { signal });
		signal.throwIfAborted();
		const candidates = this.catalog.available(available);
		const current = this.session.model;
		if (
			current &&
			candidates.some(
				(model) =>
					model.provider === current.provider &&
					model.id === current.id,
			)
		) {
			return;
		}
		const model =
			candidates.find(
				(model) =>
					model.provider ===
					(provider ??
						(current?.provider === "openai-codex"
							? "openai"
							: current?.provider)),
			) ?? candidates[0];
		if (model) {
			await this.session.setModel(model);
		}
	}

	/** 明示的なモデル変更だけを次回起動用に保存する。 */
	private async rememberModel(
		provider: string,
		model: string,
	): Promise<void> {
		await this.saveModel?.({
			provider,
			model,
			reasoning: this.controls.snapshot().effectiveReasoning,
		});
	}

	/** プロバイダー単位の設定状態と、実行できる認証方式を表示する。 */
	private async items(signal: AbortSignal): Promise<PiAuthItem[]> {
		const credentials = await this.models.listCredentials({ signal });
		return this.models.getProviders().map((provider) => ({
			id: provider.id,
			name: provider.name,
			configured: this.models.getProviderAuthStatus(provider.id)
				.configured,
			accounts:
				this.credentials?.vault.list(provider.id).map((account) => ({
					id: account.id,
					name: account.name,
					mode: account.mode,
					active:
						this.credentials?.vault.selected(provider.id)?.id ===
						account.id,
				})) ?? [],
			methods: [
				...(this.credentials?.vault
					.list(provider.id)
					.flatMap((account) => [
						{
							id: JSON.stringify([
								provider.id,
								"select",
								account.id,
							]),
							name: `使用: ${account.name}`,
						},
						{
							id: JSON.stringify([
								provider.id,
								"delete",
								account.id,
							]),
							name: `削除: ${account.name}`,
						},
					]) ?? []),
				...(provider.auth.apiKey?.login
					? [
							{
								id: JSON.stringify([provider.id, "api_key"]),
								name: "APIキーを設定",
							},
						]
					: []),
				...(provider.auth.oauth
					? [
							{
								id: JSON.stringify([provider.id, "oauth"]),
								name: "OAuthでログイン",
							},
						]
					: []),
				...(credentials.some((item) => item.providerId === provider.id)
					? [
							{
								id: JSON.stringify([provider.id, "logout"]),
								name: "保存した認証を削除",
							},
						]
					: []),
			],
		}));
	}
}

/** 現在の認証候補に含まれる操作だけを受け付ける。 */
function supportsAuthOperation(items: PiAuthItem[], id: string) {
	return items.some((item) =>
		item.methods.some((method) => method.id === id),
	);
}

/** 認証済みの場合だけ方式を調べ、秘密値を含まない状態名を返す。 */
function authStatusLabel(
	models: ModelRuntime,
	provider: string,
	configured: boolean | undefined,
) {
	if (configured) {
		if (models.isUsingOAuth(provider)) {
			return "OAuth設定済み";
		}
		return "APIキー・環境設定あり";
	}
	return "認証未設定";
}

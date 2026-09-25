// 認証の秘密値を Host 内に留め、モデル選択と公開状態をまとめる。
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { ChatState } from "../../../shared/chatState";
import type { PiAuthItem } from "../../../shared/piAuth";
import { PiProviderControls } from "./PiProviderControls";
import { piModelOptions } from "./PiModelOptions";
import { PiModelCatalogService } from "./PiModelCatalogService";
import type { PiModelSelection } from "./PiRuntime";

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
	constructor(
		private models: ModelRuntime,
		private session: AgentSession,
		private service?: PiAuthService,
		readonly controls = new PiProviderControls(),
		readonly catalog = new PiModelCatalogService(models, session),
		private saveModel?: (selection: PiModelSelection) => Promise<void>,
		private initialSelection?: PiModelSelection,
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

	/** 新規起動時だけ保存した推論を適用し、非対応値は現在の候補へ戻す。 */
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
			authMethods: [{ id: "pi", name: "Piの認証情報を管理" }],
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

	/** Pi の利用可能モデルから選ぶ。カタログを取得済みの場合は、その公開候補にも含まれるモデルに限定する。 */
	async selectModel(value: string, signal: AbortSignal): Promise<void> {
		const available = await this.models.getAvailable(undefined, { signal });
		const target = available.find(
			(item) => `${item.provider}/${item.id}` === value,
		);
		if (target) {
			await this.catalog.refresh(target.provider, signal);
		}
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

	/** プロバイダー変更では利用可能な先頭モデルを選び、SDK の範囲内への補正を使う。 */
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

	/** 宣言型 UI の設定 ID を Host の操作に限定する。 */
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

	/** 保存認証だけを変更し、環境変数や `models.json` は保持する。 */
	async authenticate(_logout: boolean, signal: AbortSignal): Promise<void> {
		if (!this.service) {
			throw new Error("Piの認証画面が接続されていません。");
		}
		let authenticatedProvider: string | undefined;
		if (this.service.manage) {
			await this.service.manage(
				() => this.items(signal),
				async (id, operationSignal) => {
					const items = await this.items(operationSignal);
					if (
						!items.some((item) =>
							item.methods.some((method) => method.id === id),
						)
					) {
						throw new Error("未対応の認証操作です。");
					}
					const [provider, type] = JSON.parse(id) as [
						string,
						"oauth" | "api_key" | "logout",
					];
					this.catalog.invalidate();
					if (type === "logout") {
						await this.models.logout(provider, {
							signal: operationSignal,
						});
					} else {
						await this.models.login(
							provider,
							type,
							this.service!.interaction(operationSignal),
						);
						authenticatedProvider = provider;
					}
					operationSignal.throwIfAborted();
					await this.catalog.refresh(provider, operationSignal);
					await this.reconcileModel(
						operationSignal,
						authenticatedProvider,
					);
				},
				signal,
			);
			// 認証の保存直後に画面が閉じられても、操作の取消とは別に接続状態を確定する。
			if (!signal.aborted) {
				await this.reconcileModel(signal, authenticatedProvider);
			}
			return;
		}
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
				(model) => model.provider === (provider ?? current?.provider),
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
			methods: [
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

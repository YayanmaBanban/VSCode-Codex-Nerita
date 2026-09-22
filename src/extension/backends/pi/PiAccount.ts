// 認証の秘密値をHost内に留め、モデル選択と公開状態をまとめる。
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { ChatState } from "../../../shared/chatState";
import type { PiAuthItem } from "../../../shared/piAuth";
import { PiProviderControls } from "./PiProviderControls";
import { piModelOptions } from "./PiModelOptions";
import { PiModelCatalogService } from "./PiModelCatalogService";

/** SDKの認証対話をVS Codeとテストで差し替える。 */
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
	) {
		controls.bind(session);
		controls.bindCatalog((provider) => catalog.snapshot(provider));
	}

	/** 接続・履歴復元時はlive metadataを取得してから同じ補正経路を通す。 */
	async refreshCatalog(signal: AbortSignal): Promise<void> {
		const provider = this.session.model?.provider;
		if (!provider || this.catalog.snapshot(provider) === undefined) {
			return;
		}
		await this.catalog.refresh(provider, signal);
		signal.throwIfAborted();
		try {
			await this.reconcileModel(signal);
		} catch {
			signal.throwIfAborted();
		}
		this.controls.snapshot();
	}

	/** キー、トークン、SDKの認証結果そのものは公開しない。 */
	snapshot(): Partial<ChatState> {
		const model = this.session.model;
		const controls = this.controls.snapshot();
		const available = this.models.getAvailableSnapshot();
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
				? `${model.provider}: ${status?.configured ? (this.models.isUsingOAuth(model.provider) ? "OAuth設定済み" : "APIキー・環境設定あり") : "認証未設定"}`
				: "Pi: モデル・認証未設定",
			configOptions: piModelOptions(
				this.session,
				this.controls,
				available,
				this.catalog,
			),
		};
	}

	/** 利用可能なカタログに含まれるモデルだけを選ぶ。 */
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
		this.controls.snapshot();
	}

	/** Provider変更では利用可能な先頭モデルを選び、SDKのclampを使う。 */
	async selectProvider(value: string, signal: AbortSignal): Promise<void> {
		const available = await this.models.getAvailable(undefined, { signal });
		await this.catalog.refresh(value, signal);
		signal.throwIfAborted();
		const model = this.catalog
			.available(available)
			.find((item) => item.provider === value);
		if (!model) {
			throw new Error("利用可能なPi providerを選択してください。");
		}
		if (this.session.model?.provider === value) {
			return;
		}
		await this.session.setModel(model);
		this.controls.snapshot();
	}

	/** 現在のモデルが対応する推論レベルだけをSDKへ渡す。 */
	selectThinkingLevel(value: string, signal: AbortSignal): void {
		this.controls.selectReasoning(value, signal);
	}

	/** 宣言型UIの設定IDをHostの操作に限定する。 */
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
			this.selectThinkingLevel(value, signal);
		} else {
			this.controls.configure(id, value, signal);
		}
	}

	/** 保存認証だけを変更し、環境変数やmodels.jsonは保持する。 */
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

	/** 認証切れの旧モデルを保持せず、利用可能なモデルへ復帰する。 */
	private async reconcileModel(
		signal: AbortSignal,
		provider?: string,
	): Promise<void> {
		const available = await this.models.getAvailable(undefined, { signal });
		signal.throwIfAborted();
		const current = this.session.model;
		if (
			current &&
			this.catalog.canRetain(current) &&
			available.some(
				(model) =>
					model.provider === current.provider &&
					model.id === current.id,
			)
		) {
			return;
		}
		const candidates = this.catalog.available(available);
		const model =
			candidates.find(
				(model) => model.provider === (provider ?? current?.provider),
			) ?? candidates[0];
		if (model) {
			await this.session.setModel(model);
		}
	}

	/** provider単位の設定状態と、実行できる認証方式を表示する。 */
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

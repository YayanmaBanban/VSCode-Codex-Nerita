// 認証の秘密値をHost内に留め、モデル選択と公開状態をまとめる。
import type {
	AgentSession,
	ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { ChatState } from "../../../shared/chatState";
import type { PiAuthItem } from "../../../shared/piAuth";

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
	) {}

	/** キー、トークン、SDKの認証結果そのものは公開しない。 */
	snapshot(): Partial<ChatState> {
		const model = this.session.model;
		const available = this.models.getAvailableSnapshot();
		const status = model
			? this.models.getProviderAuthStatus(model.provider)
			: undefined;
		return {
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
			configOptions: [
				{
					id: "model",
					name: "Pi Model",
					currentValue: model ? `${model.provider}/${model.id}` : "",
					options: available.map((item) => ({
						value: `${item.provider}/${item.id}`,
						name: `${item.name} (${item.provider})`,
					})),
				},
			],
		};
	}

	/** 利用可能なカタログに含まれるモデルだけを選ぶ。 */
	async selectModel(value: string, signal: AbortSignal): Promise<void> {
		const model = (
			await this.models.getAvailable(undefined, { signal })
		).find((item) => `${item.provider}/${item.id}` === value);
		if (!model) {
			throw new Error("利用可能なPiモデルを選択してください。");
		}
		signal.throwIfAborted();
		await this.session.setModel(model);
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
			available.some(
				(model) =>
					model.provider === current.provider &&
					model.id === current.id,
			)
		) {
			return;
		}
		const model =
			available.find((model) => model.provider === provider) ??
			available[0];
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

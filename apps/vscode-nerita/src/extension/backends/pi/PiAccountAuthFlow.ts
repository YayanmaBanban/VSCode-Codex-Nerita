// 認証の操作・対話・一覧を所有し、成功後のモデル再同期を呼び出し元へ委ねる。
import { z } from "zod";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { PiAuthItem } from "@nerita/shared/piAuth";
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

/** 操作前の無効化と成功後の再同期を呼び出し元へ委ねる。 */
export class PiAccountAuthFlow {
	constructor(
		private readonly models: ModelRuntime,
		private readonly service: PiAuthService | undefined,
		private readonly deviceId: (() => Promise<string>) | undefined,
		private readonly credentials: PiCredentialStore | undefined,
		private readonly invalidate: () => void,
		private readonly changed: (
			provider: string | undefined,
			signal: AbortSignal,
		) => Promise<void>,
	) {}

	/** 認証の管理操作は一覧で提示した ID だけを受け付ける。 */
	async authenticate(signal: AbortSignal): Promise<void> {
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
			await this.changed(undefined, signal);
		}
	}

	/** アカウントの選択と削除にも、モデル・カタログの再同期を適用する。 */
	private async executeAuthOperation(id: string, signal: AbortSignal) {
		if (!supportsAuthOperation(await this.items(signal), id)) {
			throw new Error("未対応の認証操作です。");
		}
		const [provider, type, accountId] = z
			.tuple([
				z.string(),
				z.enum(["api_key", "oauth", "logout", "select", "delete"]),
				z.string().optional(),
			])
			.parse(JSON.parse(id));
		this.invalidate();
		if (type === "select" || type === "delete") {
			if (!this.credentials || !isNonEmptyString(accountId)) {
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
		await this.changed(provider, signal);
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
				isNonEmptyString(deviceId)
					? { getDeviceId: () => deviceId }
					: undefined,
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
				interaction.notify(
					privateAuthEvent(
						event,
						(value) => redactor?.text(value) ?? value,
					),
				),
		};
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

/** 認証 URL やユーザーコードが保護対象なら、その値を公開しない情報通知へ変換する。 */
function privateAuthEvent(
	event: Parameters<ReturnType<PiAuthService["interaction"]>["notify"]>[0],
	protect: (value: string) => string,
): Parameters<ReturnType<PiAuthService["interaction"]>["notify"]>[0] {
	if (event.type === "progress") {
		return { type: "progress", message: protect(event.message) };
	}
	if (event.type === "info") {
		return {
			type: "info",
			message: protect(event.message),
			...(event.links === undefined
				? {}
				: {
						links: event.links
							.filter((link) => protect(link.url) === link.url)
							.map((link) => ({
								url: link.url,
								...(link.label === undefined
									? {}
									: { label: protect(link.label) }),
							})),
					}),
		};
	}
	const url = event.type === "auth_url" ? event.url : event.verificationUri;
	if (
		protect(url) !== url ||
		(event.type === "device_code" &&
			protect(event.userCode) !== event.userCode)
	) {
		return {
			type: "info",
			message: "認証通知に秘密値が含まれるため非公開にしました。",
		};
	}
	if (event.type === "auth_url") {
		return {
			...event,
			...(event.instructions === undefined
				? {}
				: { instructions: protect(event.instructions) }),
		};
	}
	return event;
}

// Provider の候補確認と秘密値の取得を分け、ブローカーだけが取得処理を起動する。
import type {
	CredentialBinding,
	CredentialKind,
} from "@nerita/shared/credentials";
import type { SecretValue } from "./CredentialStore";

/** 対象は Host が Binding と実行要求から確定し、モデルから秘密参照を受け付けない。 */
export type CredentialRequirement = {
	kind: CredentialKind;
	service: string;
	target: string;
	tool: string;
	operation: string;
	workspace: string;
};
export type CredentialCandidate = {
	requirement: CredentialRequirement;
	binding: CredentialBinding;
	providerId: string;
};
export type CredentialMaterial = {
	type: "token" | "username-password" | "npm-basic";
	secret: SecretValue;
	username?: SecretValue;
};
export type CredentialProvider = {
	readonly id: string;
	inspect(
		requirement: CredentialRequirement,
		binding: CredentialBinding,
		signal: AbortSignal,
	): Promise<CredentialCandidate[]>;
	acquire(
		candidate: CredentialCandidate,
		signal: AbortSignal,
	): Promise<CredentialMaterial>;
};
/** 取得に失敗しても別の Provider を探さない。 */
export class CredentialProviderRegistry {
	private readonly providers = new Map<string, CredentialProvider>();
	constructor(providers: CredentialProvider[]) {
		for (const provider of providers) {
			if (this.providers.has(provider.id)) {
				throw new Error("Provider ID が重複しています。");
			}
			this.providers.set(provider.id, provider);
		}
	}
	get(id: string) {
		const provider = this.providers.get(id);
		if (!provider) {
			throw new Error("資格情報 Provider が登録されていません。");
		}
		return provider;
	}
}

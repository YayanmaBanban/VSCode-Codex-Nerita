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
/** 取得前の資格情報候補。要求・参照設定・取得元を同じ組のまま承認と取得へ渡す。 */
export type CredentialCandidate = {
	requirement: CredentialRequirement;
	binding: CredentialBinding;
	providerId: string;
};
/** 取得した秘密値と認証方式。利用側は表示やログへ渡さず、指定された注入先だけで使用する。 */
export type CredentialMaterial = {
	type: "token" | "username-password" | "npm-basic";
	secret: SecretValue;
	username?: SecretValue;
};
/** 候補の調査と秘密値の取得を分ける境界。調査では秘密値を取得せず、承認後の候補だけを取得へ渡す。 */
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
	/** 取得元の ID を重複なく登録し、参照から一意に取得先を決められるようにする。 */
	constructor(providers: CredentialProvider[]) {
		for (const provider of providers) {
			if (this.providers.has(provider.id)) {
				throw new Error("Provider ID が重複しています。");
			}
			this.providers.set(provider.id, provider);
		}
	}
	/** 未登録の取得元を暗黙に代替せず、設定不足として拒否する。 */
	get(id: string) {
		const provider = this.providers.get(id);
		if (!provider) {
			throw new Error("資格情報 Provider が登録されていません。");
		}
		return provider;
	}
}

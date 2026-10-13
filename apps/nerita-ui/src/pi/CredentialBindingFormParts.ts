// 資格情報の参照フォームを、検証済みの保存形式へ変換する。

import {
	credentialBindingSchema,
	type CredentialBinding,
} from "@nerita/shared/credentials";

import { nonEmptyString } from "@nerita/shared/valuePredicates";
/** フォームの入力を資格情報の参照設定へ変換し、用途と取得元に合う保存形式を検証する。 */
export function parseBindingForm(
	form: FormData,
	provider: CredentialBinding["provider"]["type"],
	kind: CredentialBinding["match"]["kind"],
) {
	const field = (name: string) => {
		const value = form.get(name);
		return typeof value === "string" ? value.trim() : "";
	};
	const projectId = field("projectId");
	const projectScope = projectId !== "" ? { projectId } : {};
	const reference =
		provider === "bitwarden-secrets-manager"
			? {
					type: provider,
					secretId: field("secretId"),
					...projectScope,
					accountId: nonEmptyString(field("accountId")) ?? "default",
				}
			: { type: provider };
	const types = {
		"git-https": "git-https",
		"npm-registry": "npm-auth-token",
		"api-token": "env",
		"username-password": "env",
	};
	const injection =
		types[kind] === "env"
			? { type: "env", name: field("name") }
			: { type: types[kind] };
	return credentialBindingSchema.safeParse({
		id: field("id"),
		match: { kind, target: field("target") },
		provider: reference,
		injection,
	});
}

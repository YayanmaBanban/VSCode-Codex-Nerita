// 表示用の型と文書変換を共有し、各入力欄では状態を複製しない。

import {
	credentialBindingSchema,
	type CredentialBinding,
} from "@nerita/shared/credentials";

import { nonEmptyString } from "@nerita/shared/valuePredicates";
/** 編集対象と表示結果の対応を、各欄で同じ契約として扱う。 */
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

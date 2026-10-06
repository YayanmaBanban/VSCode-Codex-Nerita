// フォームは参照 ID と対象だけを扱い、秘密値を受信しない。
import { nonEmptyString } from "@nerita/shared/valuePredicates";
import { useState } from "react";
import {
	credentialBindingSchema,
	type CredentialBinding,
} from "@nerita/shared/credentials";

/** 認証方式ごとに必要な参照項目だけを表示する。 */
export function BindingForm({
	binding,
	busy,
	save,
}: {
	binding: CredentialBinding | undefined;
	busy: boolean;
	save: (binding: CredentialBinding) => void;
}) {
	const [provider, setProvider] = useState(
		binding?.provider.type ?? "bitwarden-secrets-manager",
	);
	const [kind, setKind] = useState(binding?.match.kind ?? "npm-registry");
	const [error, setError] = useState("");
	return (
		<form
			className="mt-[16px] flex max-w-[560px] flex-col gap-[12px]"
			onSubmit={(event) => {
				event.preventDefault();
				const parsed = parseBindingForm(
					new FormData(event.currentTarget),
					provider,
					kind,
				);
				if (!parsed.success) {
					setError(
						"ID・対象・Provider と注入方式を確認してください。",
					);
					return;
				}
				setError("");
				save(parsed.data);
			}}
		>
			<BindingIdentity binding={binding} busy={busy} />
			<BindingSelectors
				busy={busy}
				provider={provider}
				setProvider={setProvider}
				kind={kind}
				setKind={setKind}
			/>
			{provider === "bitwarden-secrets-manager" && (
				<BitwardenFields binding={binding} busy={busy} />
			)}
			{kind.endsWith("token") || kind === "username-password" ? (
				<EnvironmentField binding={binding} busy={busy} />
			) : null}
			{error !== "" && <p role="alert">{error}</p>}
			<button type="submit" disabled={busy}>
				Binding を保存
			</button>
		</form>
	);
}
/** `FormData` のファイル値を文字列化せず、認証方式ごとの構造を組み立てる。 */
function parseBindingForm(
	form: FormData,
	provider: CredentialBinding["provider"]["type"],
	kind: CredentialBinding["match"]["kind"],
) {
	const field = (name: string) => {
		const value = form.get(name);
		return typeof value === "string" ? value.trim() : "";
	};
	const projectId = field("projectId");
	const reference =
		provider === "bitwarden-secrets-manager"
			? {
					type: provider,
					secretId: field("secretId"),
					...(projectId !== "" ? { projectId } : {}),
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

/** 秘密情報本体ではなく、取得する項目の ID を指定する。 */
function BitwardenFields({
	binding,
	busy,
}: {
	binding: CredentialBinding | undefined;
	busy: boolean;
}) {
	const reference =
		binding?.provider.type === "bitwarden-secrets-manager"
			? binding.provider
			: undefined;
	return (
		<>
			<label>
				シークレット ID{" "}
				<input
					name="secretId"
					required
					defaultValue={reference?.secretId}
					disabled={busy}
					className="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
				/>
			</label>
			<label>
				プロジェクト ID（任意）{" "}
				<input
					name="projectId"
					defaultValue={reference?.projectId}
					disabled={busy}
					className="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
				/>
			</label>
			<label>
				マシンアカウント ID{" "}
				<input
					name="accountId"
					required
					defaultValue={reference?.accountId ?? "default"}
					disabled={busy}
					className="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
				/>
			</label>
		</>
	);
}

/** 実行先へ渡す環境変数の名前だけを指定する。 */
function EnvironmentField({
	binding,
	busy,
}: {
	binding: CredentialBinding | undefined;
	busy: boolean;
}) {
	return (
		<label>
			注入先の環境変数名{" "}
			<input
				name="name"
				required
				defaultValue={
					binding?.injection.type === "env"
						? binding.injection.name
						: ""
				}
				disabled={busy}
				className="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
			/>
		</label>
	);
}
/** 編集時の ID は固定し、対象だけを更新できる。 */
function BindingIdentity({
	binding,
	busy,
}: {
	binding: CredentialBinding | undefined;
	busy: boolean;
}) {
	return (
		<>
			{" "}
			<label>
				Binding ID{" "}
				<input
					name="id"
					required
					defaultValue={binding?.id}
					disabled={busy || Boolean(binding)}
					className="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
				/>
			</label>
			{/* 無効化した ID 入力欄は `FormData` に含まれないため、編集時は隠し入力欄で固定 ID を渡す。 */}
			{binding && <input type="hidden" name="id" value={binding.id} />}
			<label>
				対象{" "}
				<input
					name="target"
					required
					defaultValue={binding?.match.target}
					placeholder="npm.pkg.github.com"
					disabled={busy}
					className="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
				/>
			</label>
		</>
	);
}

/** 用途と参照元を選択する。 */
function BindingSelectors({
	busy,
	provider,
	setProvider,
	kind,
	setKind,
}: {
	busy: boolean;
	provider: CredentialBinding["provider"]["type"];
	setProvider: (value: CredentialBinding["provider"]["type"]) => void;
	kind: CredentialBinding["match"]["kind"];
	setKind: (value: CredentialBinding["match"]["kind"]) => void;
}) {
	return (
		<>
			<label>
				用途{" "}
				<select
					value={kind}
					disabled={busy}
					onChange={(event) =>
						setKind(event.target.value as typeof kind)
					}
					className="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
				>
					<option value="git-https">Git HTTPS</option>
					<option value="npm-registry">npm レジストリ</option>
					<option value="api-token">API トークン</option>
					<option value="username-password">
						ユーザー名・パスワード
					</option>
				</select>
			</label>
			<label>
				Provider{" "}
				<select
					value={provider}
					disabled={busy}
					onChange={(event) =>
						setProvider(event.target.value as typeof provider)
					}
					className="w-full rounded-[4px] border border-menu-border bg-menu p-[10px] text-menu-text outline-settings-focus"
				>
					<option value="git">Git</option>
					<option value="npmrc">npmrc</option>
					<option value="bitwarden-secrets-manager">
						Bitwarden Secrets Manager
					</option>
				</select>
			</label>
		</>
	);
}

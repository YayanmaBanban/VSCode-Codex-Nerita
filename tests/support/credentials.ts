// 保存 API だけを置き換え、製品のストア・アカウント管理・SDK をそのまま使う。
import {
	CredentialStores,
	VsCodeSecretCredentialStore,
} from "../../apps/vscode-nerita/src/extension/credentials/CredentialStore";
import {
	PiCredentialStore,
	PiCredentialVault,
} from "../../apps/vscode-nerita/src/extension/credentials/PiCredentialStore";

/** Host を作り直しても、SecretStorage の外部境界と非秘密メタデータだけは残す。 */
export function credentialFixture() {
	const secrets = new Map<string, string>();
	let metadata: unknown;
	const api = {
		get: (key: string) => Promise.resolve(secrets.get(key)),
		store: (key: string, value: string) => {
			secrets.set(key, value);
			return Promise.resolve();
		},
		delete: (key: string) => {
			secrets.delete(key);
			return Promise.resolve();
		},
	};
	const restart = () => {
		const stores = new CredentialStores(
			new VsCodeSecretCredentialStore(api),
		);
		const vault = new PiCredentialVault(stores, {
			read: () => metadata,
			write: (value) => {
				metadata = structuredClone(value);
				return Promise.resolve();
			},
		});
		return { stores, vault, credentials: new PiCredentialStore(vault) };
	};
	return { secrets, metadata: () => metadata, restart, ...restart() };
}

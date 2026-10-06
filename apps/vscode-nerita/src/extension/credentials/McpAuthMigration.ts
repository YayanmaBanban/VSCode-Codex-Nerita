// MCP の既存認証はモデル認証と別に取り込み、秘密ストアの読み戻し後に確定する。
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readLegacyAuth } from "./PiAuthMigration";
import { SecretValue, type CredentialStore } from "./CredentialStore";
import type { SecretAuthBackend } from "./SecretAuthBackend";

/** 現在の MCP 認証を優先し、既存ファイルは移行後も削除しない。 */
export async function prepareMcpAuthMigration(
	file: string,
	store: CredentialStore,
	backend: SecretAuthBackend,
) {
	const records = z
		.record(z.string(), z.record(z.string(), z.unknown()))
		.parse(await readLegacyAuth(file));
	const text = JSON.stringify(records);
	const key = `pi.mcp.migration.${randomUUID()}`;
	const value = new SecretValue(text);
	let readback: SecretValue | undefined;
	try {
		await store.set(key, value);
		readback = await store.get(key);
		if (readback?.use((stored) => stored !== text) !== false) {
			throw new Error("MCP 移行先の読み戻しが一致しません。");
		}
	} catch (error) {
		await store.delete(key);
		throw error;
	} finally {
		value.dispose();
		readback?.dispose();
	}
	let finished = false;
	return {
		count: Object.keys(records).length,
		commit: async () => {
			if (finished) {
				throw new Error("MCP 移行は既に終了しています。");
			}
			backend.withLock((current) => {
				const existing = isNonEmptyString(current)
					? z
							.record(z.string(), z.unknown())
							.parse(JSON.parse(current))
					: {};
				return {
					result: undefined,
					next: JSON.stringify({ ...records, ...existing }),
				};
			});
			await backend.flush();
			finished = true;
			await store.delete(key);
		},
		cancel: async () => {
			if (!finished) {
				finished = true;
				await store.delete(key);
			}
		},
	};
}

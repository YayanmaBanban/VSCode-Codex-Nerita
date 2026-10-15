// 状態・監査・Host 記録の途中失敗を操作 ID で照合し、確認できた保存だけを復旧する。
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type SafeDlcFiles, jsonDigest } from "./SafeDlcFiles";
import {
	AuthorityRecordSchema,
	type AuthorityRecord,
	type IntentAuthority,
} from "./IntentAuthority";

const journalSchema = z.strictObject({
	schemaVersion: z.literal(1),
	operationId: z.uuid(),
	stateRevision: z.number().int().nonnegative(),
	previousDigest: z.string().nullable(),
	nextDigest: z.string(),
	metadataDigest: z.string(),
	next: z.unknown(),
});

/** 呼び出し側がウィンドウ間のロックを取得してから使う。 */
export class TrustedDocuments {
	/** 文書の実体と承認記録の保存先を結び付け、索引のキーは指定した領域へ隔離する。 */
	constructor(
		private files: SafeDlcFiles,
		private authority: IntentAuthority,
		private prefix: string,
	) {}
	/** 他の Extension Host が実行中なら、その状態を異常終了として復旧しない。 */
	assertResumable(key: string): void {
		const record = AuthorityRecordSchema.parse(
			this.authority.read(`${this.prefix}.${key}`),
		);
		const pid = record.ownerProcessId;
		if (pid === undefined) {
			throw new Error(
				"実行元プロセスの ID を確認できません。保存記録を残して確認してください。",
			);
		}
		if (pid === process.pid) {
			return;
		}
		try {
			process.kill(pid, 0);
		} catch (error) {
			const matchesError =
				error instanceof Error &&
				"code" in error &&
				error.code === "ESRCH";
			if (matchesError) {
				return;
			}
			throw new Error("実行元プロセスの終了を確認できません。", {
				cause: error,
			});
		}
		throw new Error(
			"別のウィンドウがこの Intent を実行しています。終了後に再読込みしてください。",
		);
	}

	/** ローカルに書かれた形が正しくても、Host が確定したハッシュと異なれば拒否する。 */
	async load<T>(
		key: string,
		path: string,
		audit: string,
		schema: z.ZodType<T>,
		metadataDigest: string,
	): Promise<T | undefined> {
		const saved = this.authority.read(`${this.prefix}.${key}`);
		const text = await this.files.read(path);
		if (saved === undefined) {
			if (text !== undefined) {
				throw new Error(
					`このファイルに対応する Host 側の保存記録がありません: ${path}`,
				);
			}
			return undefined;
		}
		const record = AuthorityRecordSchema.parse(saved);
		if (record.metadataDigest !== metadataDigest) {
			throw new Error(
				`DLC の本文または識別情報が変更されています: ${path}`,
			);
		}
		let current: unknown;
		if (text !== undefined) {
			current = JSON.parse(text);
		}
		if (current === undefined || jsonDigest(current) !== record.digest) {
			current = await this.recover(
				path,
				audit,
				schema,
				record,
				metadataDigest,
				current,
			);
		}
		const value = schema.parse(current);
		await this.confirmAudit(audit, record);
		return value;
	}

	/** 未完了の監査記録と前後のハッシュを照合し、承認された次状態だけを安全に復旧する。 */
	private async recover<T>(
		path: string,
		audit: string,
		schema: z.ZodType<T>,
		record: AuthorityRecord,
		metadataDigest: string,
		current: unknown,
	): Promise<T> {
		const pendingText = await this.files.read(
			`${audit}/${record.operationId}.pending.json`,
		);
		if (pendingText === undefined) {
			throw new Error(`DLC の復旧に必要な保存処理中の監査記録がありません: ${path}`);
		}
		const pending = journalSchema.parse(JSON.parse(pendingText));
		const matchesOperationId =
			pending.operationId !== record.operationId ||
			pending.stateRevision !== record.revision ||
			pending.metadataDigest !== metadataDigest;
		if (matchesOperationId) {
			throw new Error(`DLC の復旧用記録が、保存処理または本文の識別情報と一致しません: ${path}`);
		}
		const matchesNextDigest =
			pending.nextDigest !== record.digest ||
			jsonDigest(pending.next) !== record.digest;
		if (matchesNextDigest) {
			throw new Error(`DLC の復旧用データのハッシュが、Host 側の保存記録と一致しません: ${path}`);
		}
		const matchesCurrent =
			current !== undefined &&
			jsonDigest(current) !== pending.previousDigest;
		if (matchesCurrent) {
			throw new Error(`DLC の現在の保存内容が、復旧用記録にある変更前の内容と一致しません: ${path}`);
		}
		const recovered = schema.parse(pending.next);
		await this.files.write(path, recovered);
		return recovered;
	}
	/** 確定イベントを未作成の場合だけ保存し、既存の監査記録との不一致を拒否する。 */
	private async confirmAudit(
		audit: string,
		record: AuthorityRecord,
	): Promise<void> {
		const committed = `${audit}/${record.operationId}.json`;
		const event = {
			schemaVersion: 1,
			operationId: record.operationId,
			stateRevision: record.revision,
			digest: record.digest,
			status: "committed",
		};
		const committedText = await this.files.read(committed);
		if (committedText === undefined) {
			await this.files.write(committed, event);
		} else {
			const auditChanged =
				jsonDigest(JSON.parse(committedText)) !== jsonDigest(event);
			if (auditChanged) {
				throw new Error("DLC の確定済み監査記録が、確定する保存処理の内容と一致しません。");
			}
		}
	}
	/** 監査準備 → Host の確定 → 状態 → 監査確定の順。途中失敗は load が照合して回復する。 */
	async commit<T>(
		key: string,
		path: string,
		audit: string,
		schema: z.ZodType<T>,
		value: T,
		revision: number,
		expected: number,
		metadataDigest: string,
	): Promise<void> {
		await this.load(key, path, audit, schema, metadataDigest);
		const previous = this.authority.read(`${this.prefix}.${key}`);
		const record =
			previous === undefined
				? undefined
				: AuthorityRecordSchema.parse(previous);
		const matchesRevision =
			(record?.revision ?? -1) !== expected || revision !== expected + 1;
		if (matchesRevision) {
			throw new Error(
				"DLC の保存が競合しています。最新の状態を再読込みしてください。",
			);
		}
		const next = schema.parse(value);
		const operationId = randomUUID();
		const digest = jsonDigest(next);
		await this.files.directory(audit);
		await this.files.write(`${audit}/${operationId}.pending.json`, {
			schemaVersion: 1,
			operationId,
			stateRevision: revision,
			previousDigest: record?.digest ?? null,
			nextDigest: digest,
			metadataDigest,
			next,
		});
		await this.authority.write(`${this.prefix}.${key}`, {
			revision,
			digest,
			operationId,
			metadataDigest,
			ownerProcessId: process.pid,
		});
		await this.files.write(path, next);
		await this.load(key, path, audit, schema, metadataDigest);
	}
}

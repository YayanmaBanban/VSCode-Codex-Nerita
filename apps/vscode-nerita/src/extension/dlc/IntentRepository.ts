// Space・Intent の索引と保存を管理する。選択中の Intent は利用者別の Host 状態に任せる。
import { createHash, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import {
	SpaceSchema,
	IntentRegistrySchema,
	IntentDirectorySchema,
	IntentMetadataSchema,
	IntentStateSchema,
	createIntentState,
	intentProjection,
	type IntentState,
	type IntentRegistry,
	type IntentMetadata,
} from "@nerita/dlc/state";
import {
	stageCatalog,
	catalogVersion,
	profileVersion,
} from "@nerita/dlc/catalog";
import type { RoutingConditions } from "@nerita/dlc/routing";
import {
	WorkspaceDetectionSchema,
	type WorkspaceDetection,
} from "@nerita/dlc/workspace";
import type { ExecutionProfile } from "@nerita/shared/dlc/contracts";
import { type SafeDlcFiles, jsonDigest } from "./SafeDlcFiles";
import { withDlcLock } from "./DlcLock";
import { TrustedDocuments } from "./TrustedDocuments";
import { AuthorityRecordSchema, type IntentAuthority } from "./IntentAuthority";
import {
	StateDiskSchema,
	persistState,
	restoreState,
} from "./IntentPersistence";
import {
	RunContextSchema,
	RunConversationSchema,
	type RunContext,
} from "./RunContext";
import type { ChatState } from "@nerita/shared/chatState";

const spaceDirectory = ".nerita/dlc/spaces/default";
const intentsDirectory = `${spaceDirectory}/intents`;
const space = SpaceSchema.parse({ schemaVersion: 1, spaceId: "default" });
export const currentCatalogDigest = jsonDigest(stageCatalog);

/** UUIDv4 は実行環境の暗号学的乱数を使う。表示ディレクトリ名を永続 ID にしない。 */
export class IntentRepository {
	private documents: TrustedDocuments;
	private operations: Promise<void> = Promise.resolve();
	/** 同じ Host の読込みと保存を並べ、別 Host とはファイルロックで排他する。 */
	locked<T>(operation: () => Promise<T>): Promise<T> {
		const pending = this.operations.then(() =>
			withDlcLock(this.files, operation),
		);
		this.operations = pending.then(
			() => undefined,
			() => undefined,
		);
		return pending;
	}
	constructor(
		readonly files: SafeDlcFiles,
		private readonly authority: IntentAuthority,
	) {
		this.documents = new TrustedDocuments(
			files,
			authority,
			`dlc.${createHash("sha256").update(files.root).digest("hex")}`,
		);
	}
	private async directoryFor(intentId: string): Promise<string> {
		const registry = await this.registry();
		const entry = registry.entries.find(
			(item) => item.intentId === intentId,
		);
		if (!entry) {
			throw new Error("Intent が登録されていません。");
		}
		return `${intentsDirectory}/${entry.dirName}`;
	}
	directory(intentId: string): Promise<string> {
		return this.locked(() => this.directoryFor(intentId));
	}
	private runKey(intentId: string, attemptId: string, kind: string): string {
		return `dlc.run.${jsonDigest({ root: this.files.root, intentId, attemptId, kind })}`;
	}
	private async writeRun(
		intentId: string,
		attemptId: string,
		kind: string,
		value: unknown,
	): Promise<void> {
		const directory = await this.directoryFor(intentId);
		const key = this.runKey(intentId, attemptId, kind);
		if (this.authority.read(key) !== undefined) {
			throw new Error("実行記録は既に固定されています。");
		}
		const file = `${directory}/runs/${jsonDigest({ attemptId, kind }).slice(7)}.json`;
		await this.files.directory(`${directory}/runs`);
		const existing = await this.files.read(file);
		if (
			existing !== undefined &&
			jsonDigest(JSON.parse(existing)) !== jsonDigest(value)
		) {
			throw new Error("未確定の実行記録が競合しています。");
		}
		await this.files.write(file, value);
		await this.authority.write(key, {
			revision: 0,
			digest: jsonDigest(value),
			operationId: randomUUID(),
			metadataDigest: jsonDigest({ intentId, attemptId, kind }),
		});
	}
	private async readRun(
		intentId: string,
		attemptId: string,
		kind: string,
	): Promise<unknown> {
		const directory = await this.directoryFor(intentId);
		const key = this.runKey(intentId, attemptId, kind);
		const saved = this.authority.read(key);
		if (saved === undefined) {
			throw new Error("信頼済みの実行記録がありません。");
		}
		const anchor = AuthorityRecordSchema.parse(saved);
		const record = await this.files.read(
			`${directory}/runs/${jsonDigest({ attemptId, kind }).slice(7)}.json`,
			16 * 1024 * 1024,
		);
		if (record === undefined) {
			throw new Error("保存した実行記録がありません。");
		}
		const value: unknown = JSON.parse(record);
		if (
			anchor.revision !== 0 ||
			anchor.metadataDigest !==
				jsonDigest({ intentId, attemptId, kind }) ||
			anchor.digest !== jsonDigest(value)
		) {
			throw new Error("実行記録のハッシュが一致しません。");
		}
		return value;
	}
	freezeRun(context: RunContext): Promise<void> {
		const value = RunContextSchema.parse(context);
		return this.locked(() =>
			this.writeRun(
				value.request.intentId,
				value.request.attemptId,
				"context",
				value,
			),
		);
	}
	saveConversation(
		intentId: string,
		attemptId: string,
		state: ChatState,
	): Promise<void> {
		return this.locked(() =>
			this.writeRun(
				intentId,
				attemptId,
				"conversation",
				RunConversationSchema.parse(state),
			),
		);
	}
	conversation(intentId: string, attemptId: string): Promise<ChatState> {
		return this.locked(async () => {
			RunContextSchema.parse(
				await this.readRun(intentId, attemptId, "context"),
			);
			return RunConversationSchema.parse(
				await this.readRun(intentId, attemptId, "conversation"),
			);
		});
	}
	runContext(intentId: string, attemptId: string): Promise<RunContext> {
		return this.locked(async () => {
			const context = RunContextSchema.parse(
				await this.readRun(intentId, attemptId, "context"),
			);
			if (
				context.request.intentId !== intentId ||
				context.request.attemptId !== attemptId
			) {
				throw new Error("実行入力の参照が一致しません。");
			}
			return context;
		});
	}
	hasConversation(intentId: string, attemptId: string): boolean {
		return (
			this.authority.read(
				this.runKey(intentId, attemptId, "conversation"),
			) !== undefined
		);
	}
	assertResumable(state: IntentState): void {
		if (
			state.workItems.some(
				(item) =>
					item.status === "running" || item.status === "stopping",
			)
		) {
			this.documents.assertResumable(state.intentId);
		}
	}
	private async registry(): Promise<IntentRegistry> {
		await this.files.directory(intentsDirectory);
		const existing = await this.files.read(`${spaceDirectory}/space.json`);
		if (existing === undefined) {
			await this.files.write(`${spaceDirectory}/space.json`, space);
		} else {
			SpaceSchema.parse(JSON.parse(existing));
		}
		const registry = await this.documents.load(
			"registry",
			`${intentsDirectory}/intents.json`,
			`${spaceDirectory}/audit`,
			IntentRegistrySchema,
			jsonDigest(space),
		);
		if (registry !== undefined) {
			return registry;
		}
		const initial = IntentRegistrySchema.parse({
			schemaVersion: 1,
			revision: 0,
			entries: [],
		});
		await this.saveRegistry(initial, -1);
		return initial;
	}
	private saveRegistry(
		registry: IntentRegistry,
		expected: number,
	): Promise<void> {
		return this.documents.commit(
			"registry",
			`${intentsDirectory}/intents.json`,
			`${spaceDirectory}/audit`,
			IntentRegistrySchema,
			registry,
			registry.revision,
			expected,
			jsonDigest(space),
		);
	}
	private async assertNoOrphans(registry: IntentRegistry): Promise<void> {
		const entries = await readdir(await this.files.path(intentsDirectory), {
			withFileTypes: true,
		});
		const known = new Set(registry.entries.map((entry) => entry.dirName));
		if (entries.some((entry) => entry.isSymbolicLink())) {
			throw new Error("Intent レジストリ内のリンクは利用できません。");
		}
		const orphan = entries.find(
			(entry) => entry.isDirectory() && !known.has(entry.name),
		);
		if (orphan) {
			throw new Error(
				`未登録の Intent が復旧または確認待ちです: ${orphan.name}`,
			);
		}
	}
	private async loadEntry(
		entry: IntentRegistry["entries"][number],
	): Promise<IntentState> {
		const directory = `${intentsDirectory}/${IntentDirectorySchema.parse(entry.dirName)}`;
		const text = await this.files.read(`${directory}/intent.json`);
		if (text === undefined) {
			throw new Error("Intent の本文がありません。");
		}
		const intent = IntentMetadataSchema.parse(JSON.parse(text));
		if (
			intent.intentId !== entry.intentId ||
			intent.createdAt !== entry.createdAt
		) {
			throw new Error("Intent レジストリと本文の参照が一致しません。");
		}
		const disk = await this.documents.load(
			intent.intentId,
			`${directory}/state.json`,
			`${directory}/audit`,
			StateDiskSchema,
			jsonDigest(intent),
		);
		if (disk === undefined || disk.intentId !== intent.intentId) {
			throw new Error("Intent の状態がありません。");
		}
		if (disk.routing.catalogDigest !== currentCatalogDigest) {
			throw new Error(
				"Intent のカタログが現在の定義と異なります。明示的な移行が必要です。",
			);
		}
		return restoreState(this.files, directory, disk, intent);
	}
	/** 新規作成は本文と状態を先に確定し、最後にレジストリへ登録する。 */
	create(
		request: string,
		title: string,
		workspace: WorkspaceDetection,
		profile: ExecutionProfile = "classic",
		conditions: RoutingConditions = {},
		projectType?: WorkspaceDetection["classification"]["detected"],
	): Promise<IntentState> {
		return this.locked(async () => {
			await this.validateDetection(workspace);
			const registry = await this.registry();
			await this.assertNoOrphans(registry);
			const intent = IntentMetadataSchema.parse({
				schemaVersion: 1,
				spaceId: "default",
				intentId: randomUUID(),
				title,
				request,
				createdAt: new Date().toISOString(),
			});
			const state = createIntentState(
				intent,
				{
					profileId: profile,
					profileVersion,
					catalogVersion,
					catalogDigest: currentCatalogDigest,
					workspaceFingerprint: workspace.scan.inputFingerprint,
					workspaceSchemaVersion: workspace.schemaVersion,
					detectorVersion: workspace.detectorVersion,
					projectTypeSource:
						projectType === undefined ? "detected" : "user",
					effectiveProjectType:
						projectType ?? workspace.classification.detected,
				},
				conditions,
			);
			return this.register(state, registry);
		});
	}
	private async validateDetection(
		workspace: WorkspaceDetection,
	): Promise<void> {
		const text = await this.files.read(".nerita/dlc/workspace.json");
		if (
			text === undefined ||
			jsonDigest(WorkspaceDetectionSchema.parse(JSON.parse(text))) !==
				jsonDigest(WorkspaceDetectionSchema.parse(workspace))
		) {
			throw new Error(
				"ワークスペースの検出が未完了、または変更されています。再検出してください。",
			);
		}
	}
	private async register(
		state: IntentState,
		registry: IntentRegistry,
	): Promise<IntentState> {
		const date = state.intent.createdAt.slice(2, 10).replaceAll("-", "");
		const slug = state.intent.title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 50);
		const label = slug === "" ? "intent" : slug;
		const existing = new Set(
			(await readdir(await this.files.path(intentsDirectory))).map(
				(entry) => entry.toLowerCase(),
			),
		);
		let dirName = `${date}-${label}`;
		let suffix = 1;
		while (existing.has(dirName)) {
			dirName = `${date}-${label}-${++suffix}`;
		}
		IntentDirectorySchema.parse(dirName);
		const directory = `${intentsDirectory}/${dirName}`;
		await this.files.directory(directory);
		await this.files.write(`${directory}/intent.json`, state.intent);
		const disk = await persistState(this.files, directory, state);
		await this.documents.commit(
			state.intentId,
			`${directory}/state.json`,
			`${directory}/audit`,
			StateDiskSchema,
			disk,
			state.revision,
			-1,
			jsonDigest(state.intent),
		);
		const entry = {
			intentId: state.intentId,
			dirName,
			createdAt: state.intent.createdAt,
		};
		await this.saveRegistry(
			{
				...registry,
				revision: registry.revision + 1,
				entries: [...registry.entries, entry],
			},
			registry.revision,
		);
		return this.loadEntry(entry);
	}
	/** 古い書き込みは、ロック取得後に期待版を照合して拒否する。 */
	save(value: IntentState, expectedRevision: number): Promise<void> {
		return this.locked(async () => {
			const state = IntentStateSchema.parse(value);
			const registry = await this.registry();
			const entry = registry.entries.find(
				(entry) => entry.intentId === state.intentId,
			);
			if (!entry) {
				throw new Error("保存する Intent が登録されていません。");
			}
			const previous = await this.loadEntry(entry);
			if (
				previous.revision !== expectedRevision ||
				jsonDigest(previous.intent) !== jsonDigest(state.intent) ||
				jsonDigest(previous.routing) !== jsonDigest(state.routing)
			) {
				throw new Error("Intent の状態または版が競合しています。");
			}
			if (
				jsonDigest(previous.workflow.stages) !==
				jsonDigest(state.workflow.stages)
			) {
				throw new Error("未実装の工程の進行状態は変更できません。");
			}
			const directory = `${intentsDirectory}/${entry.dirName}`;
			const disk = await persistState(this.files, directory, state);
			await this.documents.commit(
				state.intentId,
				`${directory}/state.json`,
				`${directory}/audit`,
				StateDiskSchema,
				disk,
				state.revision,
				expectedRevision,
				jsonDigest(state.intent),
			);
		});
	}
	load(intentId: string): Promise<IntentState> {
		return this.locked(async () => {
			const registry = await this.registry();
			await this.assertNoOrphans(registry);
			const entry = registry.entries.find(
				(entry) => entry.intentId === intentId,
			);
			if (!entry) {
				throw new Error("選択した Intent がありません。");
			}
			return this.loadEntry(entry);
		});
	}
	list(): Promise<IntentMetadata[]> {
		return this.states().then((states) =>
			states.map((state) => state.intent),
		);
	}
	/** 一覧にも検証済みの進捗を使い、別途保存する表示用の状態を作らない。 */
	projections() {
		return this.states().then((states) => states.map(intentProjection));
	}
	private states(): Promise<IntentState[]> {
		return this.locked(async () => {
			const registry = await this.registry();
			await this.assertNoOrphans(registry);
			const values: IntentState[] = [];
			for (const entry of registry.entries) {
				values.push(await this.loadEntry(entry));
			}
			return values;
		});
	}
	/** 明示的な復旧操作だけが未登録領域を登録する。信頼済み根拠のない領域は保持して拒否する。 */
	recoverOrphans(): Promise<void> {
		return this.locked(async () => {
			let registry = await this.registry();
			const entries = await readdir(
				await this.files.path(intentsDirectory),
				{ withFileTypes: true },
			);
			for (const entry of entries) {
				if (
					!entry.isDirectory() ||
					registry.entries.some(
						(value) => value.dirName === entry.name,
					)
				) {
					continue;
				}
				const dirName = IntentDirectorySchema.parse(entry.name);
				const text = await this.files.read(
					`${intentsDirectory}/${dirName}/intent.json`,
				);
				if (text === undefined) {
					throw new Error(
						`Intent の作成が未完了です。既存領域を保持して確認してください: ${dirName}`,
					);
				}
				const intent = IntentMetadataSchema.parse(JSON.parse(text));
				const candidate = {
					intentId: intent.intentId,
					dirName,
					createdAt: intent.createdAt,
				};
				await this.loadEntry(candidate);
				const next = IntentRegistrySchema.parse({
					...registry,
					revision: registry.revision + 1,
					entries: [...registry.entries, candidate],
				});
				await this.saveRegistry(next, registry.revision);
				registry = next;
			}
		});
	}
	/** 一方向移行は旧 ID と証跡を保持し、同一 ID の再取り込みを検証して冪等にする。 */
	import(state: IntentState): Promise<IntentState> {
		return this.locked(async () => {
			const registry = await this.registry();
			await this.assertNoOrphans(registry);
			const existing = registry.entries.find(
				(entry) => entry.intentId === state.intentId,
			);
			if (existing) {
				const restored = await this.loadEntry(existing);
				if (
					restored.intent.request !== state.intent.request ||
					jsonDigest(restored.workItems) !==
						jsonDigest(state.workItems)
				) {
					throw new Error(
						"旧データと移行済み Intent が一致しません。",
					);
				}
				return restored;
			}
			return this.register(state, registry);
		});
	}
}

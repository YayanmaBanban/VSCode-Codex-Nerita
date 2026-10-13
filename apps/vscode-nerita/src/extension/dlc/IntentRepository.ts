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
	runRecordLimit,
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
			withDlcLock(this.liveFiles, operation),
		);
		this.operations = pending.then(
			() => undefined,
			() => undefined,
		);
		return pending;
	}
	/** 管理状態の保存先と文書の作業ルートを分け、信頼済み文書の記録は作業ルート単位で隔離する。 */
	constructor(
		readonly files: SafeDlcFiles,
		private readonly authority: IntentAuthority,
		private readonly liveFiles: SafeDlcFiles,
	) {
		this.documents = new TrustedDocuments(
			liveFiles,
			authority,
			`dlc.${createHash("sha256").update(liveFiles.root).digest("hex")}`,
		);
	}
	/** 登録済みの Intent だけを保存先へ解決し、任意の ID から未登録領域を参照させない。 */
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
	/** 保存先の解決も排他処理へ通し、レジストリ更新中の不整合を避ける。 */
	directory(intentId: string): Promise<string> {
		return this.locked(() => this.directoryFor(intentId));
	}
	/** 作業ルート・Intent・世代・記録種別をキーへ含め、異なる実行の承認記録を流用しない。 */
	private runKey(intentId: string, attemptId: string, kind: string): string {
		return `dlc.run.${jsonDigest({ root: this.liveFiles.root, intentId, attemptId, kind })}`;
	}
	/** 実体を書いてからハッシュを固定し、既に確定した実行記録の上書きと未確定記録の競合を拒否する。 */
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
		await this.liveFiles.directory(`${directory}/runs`);
		const existing = await this.liveFiles.read(file, runRecordLimit);
		const matchesExisting =
			existing !== undefined &&
			jsonDigest(JSON.parse(existing)) !== jsonDigest(value);
		if (matchesExisting) {
			throw new Error("未確定の実行記録が競合しています。");
		}
		await this.liveFiles.write(file, value, runRecordLimit);
		await this.authority.write(key, {
			revision: 0,
			digest: jsonDigest(value),
			operationId: randomUUID(),
			metadataDigest: jsonDigest({ intentId, attemptId, kind }),
		});
	}
	/** 承認記録と実体のハッシュ・参照を照合し、改変された実行記録を復元に使わない。 */
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
		const record = await this.liveFiles.read(
			`${directory}/runs/${jsonDigest({ attemptId, kind }).slice(7)}.json`,
			runRecordLimit,
		);
		if (record === undefined) {
			throw new Error("保存した実行記録がありません。");
		}
		const value: unknown = JSON.parse(record);
		const matchesRevision =
			anchor.revision !== 0 ||
			anchor.metadataDigest !==
				jsonDigest({ intentId, attemptId, kind }) ||
			anchor.digest !== jsonDigest(value);
		if (matchesRevision) {
			throw new Error("実行記録のハッシュが一致しません。");
		}
		return value;
	}
	/** 開始前の入力を検証して固定し、同じ世代の入力を後から差し替えない。 */
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
	/** 終了した会話を排他処理で保存し、保存済みの場合は同じ内容の再送だけを受け入れる。 */
	saveConversation(
		intentId: string,
		attemptId: string,
		state: ChatState,
	): Promise<void> {
		/** 会話記録を実行世代へ固定し、既に保存した異なる内容を上書きしない。 */
		const commitConversation = async () => {
			const value = RunConversationSchema.parse(state);
			if (this.hasConversation(intentId, attemptId)) {
				const saved = await this.readRun(
					intentId,
					attemptId,
					"conversation",
				);
				if (jsonDigest(saved) !== jsonDigest(value)) {
					throw new Error("実行記録は既に固定されています。");
				}
				return;
			}
			await this.writeRun(intentId, attemptId, "conversation", value);
		};
		return this.locked(commitConversation);
	}
	/** 実行入力と会話の両記録を検証して復元し、会話ファイルだけでは信頼済みとして扱わない。 */
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
	/** 保存された入力を検証し、要求した Intent と世代に対応する記録だけを返す。 */
	runContext(intentId: string, attemptId: string): Promise<RunContext> {
		return this.locked(async () => {
			const context = RunContextSchema.parse(
				await this.readRun(intentId, attemptId, "context"),
			);
			const matchesIntentId =
				context.request.intentId !== intentId ||
				context.request.attemptId !== attemptId;
			if (matchesIntentId) {
				throw new Error("実行入力の参照が一致しません。");
			}
			return context;
		});
	}
	/** 信頼済み会話の承認記録の有無を確認する。実体の整合性は読取り時に別途検証する。 */
	hasConversation(intentId: string, attemptId: string): boolean {
		return (
			this.authority.read(
				this.runKey(intentId, attemptId, "conversation"),
			) !== undefined
		);
	}
	/** 進行中の作業がある場合だけ文書の復旧条件を確認し、未確定の文書から実行を再開しない。 */
	assertResumable(state: IntentState): void {
		const matchesSome = state.workItems.some(
			(item) => item.status === "running" || item.status === "stopping",
		);
		if (matchesSome) {
			this.documents.assertResumable(state.intentId);
		}
	}
	/** Space の形式と信頼済み索引を確認し、索引が未作成の場合だけ初期状態を保存する。 */
	private async registry(): Promise<IntentRegistry> {
		await this.liveFiles.directory(intentsDirectory);
		const existing = await this.liveFiles.read(
			`${spaceDirectory}/space.json`,
		);
		if (existing === undefined) {
			await this.liveFiles.write(`${spaceDirectory}/space.json`, space);
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
	/** 期待する版と Space のハッシュを付けて索引を確定し、競合更新を上書きしない。 */
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
	/** リンクと未登録領域を検出し、途中まで作成された Intent を無視して後続操作を進めない。 */
	private async assertNoOrphans(registry: IntentRegistry): Promise<void> {
		const entries = await readdir(
			await this.liveFiles.path(intentsDirectory),
			{
				withFileTypes: true,
			},
		);
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
	/** レジストリ・本文・保存状態・カタログの参照を検証し、一致した状態だけを復元する。 */
	private async loadEntry(
		entry: IntentRegistry["entries"][number],
	): Promise<IntentState> {
		const directory = `${intentsDirectory}/${IntentDirectorySchema.parse(entry.dirName)}`;
		const text = await this.liveFiles.read(`${directory}/intent.json`);
		if (text === undefined) {
			throw new Error("Intent の本文がありません。");
		}
		const intent = IntentMetadataSchema.parse(JSON.parse(text));
		const matchesIntentId2 =
			intent.intentId !== entry.intentId ||
			intent.createdAt !== entry.createdAt;
		if (matchesIntentId2) {
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
				"Intent のカタログが現在の定義と異なります。新しい Intent を作成してください。",
			);
		}
		return restoreState(this.liveFiles, directory, disk, intent);
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
		/** ワークスペースの検出と登録状態を確認してから、新しい依頼と初期工程を登録する。 */
		const registerDetectedIntent = async () => {
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
		};
		return this.locked(registerDetectedIntent);
	}
	/** 保存済みの検出結果と開始要求の結果を照合し、検出変更後の古い入力で Intent を作らない。 */
	private async validateDetection(
		workspace: WorkspaceDetection,
	): Promise<void> {
		const text = await this.files.read(".nerita/dlc/workspace.json");

		if (text === undefined) {
			throw new Error(
				"ワークスペースの検出が未完了、または変更されています。再検出してください。",
			);
		}
		const detectionChanged =
			jsonDigest(WorkspaceDetectionSchema.parse(JSON.parse(text))) !==
			jsonDigest(WorkspaceDetectionSchema.parse(workspace));
		if (detectionChanged) {
			throw new Error(
				"ワークスペースの検出が未完了、または変更されています。再検出してください。",
			);
		}
	}
	/** Git 側へは停止した状態の写しだけを出力する。読込み・復旧には一切使わない。 */
	exportSnapshot(intentId: string): Promise<void> {
		/** 実行中でない依頼状態だけを Git で追跡できる履歴へ出力する。 */
		const writeHistoricalSnapshot = async () => {
			const registry = await this.registry();
			const entry = registry.entries.find(
				(item) => item.intentId === intentId,
			);
			if (!entry) {
				throw new Error("出力する Intent が登録されていません。");
			}
			const state = await this.loadEntry(entry);
			const matchesSome2 = state.workItems.some(
				(item) =>
					item.status === "running" || item.status === "stopping",
			);
			if (matchesSome2) {
				throw new Error("実行中の状態は Git の履歴へ出力できません。");
			}
			const directory = `${intentsDirectory}/${entry.dirName}`;
			await this.files.directory(directory);
			await this.files.write(`${directory}/intent.json`, state.intent);
			const disk = await persistState(this.files, directory, state);
			await this.files.write(`${directory}/state.json`, disk);
			await this.files.write(`${directory}/snapshot.json`, {
				schemaVersion: 1,
				kind: "historical-snapshot",
				intentId,
				revision: state.revision,
			});
		};
		return this.locked(writeHistoricalSnapshot);
	}
	/** 保存先の名前の競合を避け、本文と状態を確定してから索引へ登録する。 */
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
			(await readdir(await this.liveFiles.path(intentsDirectory))).map(
				(entry) => entry.toLowerCase(),
			),
		);
		await this.files.directory(intentsDirectory);
		for (const entry of await readdir(
			await this.files.path(intentsDirectory),
		)) {
			existing.add(entry.toLowerCase());
		}
		let dirName = `${date}-${label}`;
		let suffix = 1;
		while (existing.has(dirName)) {
			dirName = `${date}-${label}-${++suffix}`;
		}
		IntentDirectorySchema.parse(dirName);
		const directory = `${intentsDirectory}/${dirName}`;
		await this.liveFiles.directory(directory);
		await this.liveFiles.write(`${directory}/intent.json`, state.intent);
		const disk = await persistState(this.liveFiles, directory, state);
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
		/** 保存済みの世代・依頼本文・工程の選択を照合してから、競合のない状態更新だけを保存する。 */
		const commitIntentState = async () => {
			const state = IntentStateSchema.parse(value);
			const registry = await this.registry();
			const entry = registry.entries.find(
				(entry) => entry.intentId === state.intentId,
			);
			if (!entry) {
				throw new Error("保存する Intent が登録されていません。");
			}
			const previous = await this.loadEntry(entry);
			const matchesRevision2 =
				previous.revision !== expectedRevision ||
				jsonDigest(previous.intent) !== jsonDigest(state.intent) ||
				jsonDigest(previous.routing) !== jsonDigest(state.routing);
			if (matchesRevision2) {
				throw new Error("Intent の状態または版が競合しています。");
			}
			const matchesJsonDigest =
				jsonDigest(previous.workflow.stages) !==
				jsonDigest(state.workflow.stages);
			if (matchesJsonDigest) {
				throw new Error("未実装の工程の進行状態は変更できません。");
			}
			const directory = `${intentsDirectory}/${entry.dirName}`;
			const disk = await persistState(this.liveFiles, directory, state);
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
		};
		return this.locked(commitIntentState);
	}
	/** 未登録領域の確認と対象の復元を同じロック内で行い、破損した状態を公開しない。 */
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
	/** 検証済み状態からメタデータだけを取り出し、未検証の索引を一覧として公開しない。 */
	list(): Promise<IntentMetadata[]> {
		return this.states().then((states) =>
			states.map((state) => state.intent),
		);
	}
	/** 一覧にも検証済みの進捗を使い、別途保存する表示用の状態を作らない。 */
	projections() {
		return this.states().then((states) => states.map(intentProjection));
	}
	/** 未登録領域を確認してから登録順に全状態を検証し、不正な一件を黙って一覧から落とさない。 */
	private states(): Promise<IntentState[]> {
		/** 未登録の保存領域がないことを確認し、登録済みの依頼状態を順に読み込む。 */
		const loadRegisteredStates = async () => {
			const registry = await this.registry();
			await this.assertNoOrphans(registry);
			const values: IntentState[] = [];
			for (const entry of registry.entries) {
				values.push(await this.loadEntry(entry));
			}
			return values;
		};
		return this.locked(loadRegisteredStates);
	}
	/** 明示的な復旧操作だけが未登録領域を登録する。信頼済み根拠のない領域は保持して拒否する。 */
	recoverOrphans(): Promise<void> {
		/** 未登録の依頼ディレクトリを検証して登録し、既に登録された領域は保持する。 */
		const registerRecoveredIntents = async () => {
			let registry = await this.registry();
			const entries = await readdir(
				await this.liveFiles.path(intentsDirectory),
				{ withFileTypes: true },
			);
			for (const entry of entries) {
				if (!entry.isDirectory()) {
					continue;
				}
				const registeredDirectory = registry.entries.some(
					(value) => value.dirName === entry.name,
				);
				if (registeredDirectory) {
					continue;
				}
				const dirName = IntentDirectorySchema.parse(entry.name);
				const text = await this.liveFiles.read(
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
		};
		return this.locked(registerRecoveredIntents);
	}
}

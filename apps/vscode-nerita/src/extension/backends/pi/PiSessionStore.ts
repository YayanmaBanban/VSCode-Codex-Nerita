// Pi 標準の JSONL を保存し、選択した保存先の履歴だけを公開する。
import {
	isNonEmptyString,
	nonEmptyString,
} from "@nerita/shared/valuePredicates";

import {
	mkdir,
	readFile,
	readdir,
	realpath,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import type { SessionSummary } from "@nerita/shared/sessionHistory";
import { sameCwd } from "../../workspace";
import { piSessionContext } from "./PiSessionContext";
import { isPiSessionRunning } from "./PiSessionActivity";
import { PiOutputArchive } from "./results/PiOutputArchive";
import { readPiSessionHeader } from "./PiSessionHeader";

/** 保存先の設定値。任意パスは Webview から受け取らない。 */
export type PiSessionStorage = "global" | "workspace";
/** 一覧を取得した Host が保持し、復元先の保存領域を固定する。 */
export type PiResumeTarget = {
	id: string;
	directory: string;
	storage: PiSessionStorage;
	/** 元のファイルを保持し、選択ブランチを別の会話へ複製する。 */
	fork?: boolean;
};
/** SDK から独立した履歴一覧と初期表示の境界。 */
export type PiHistoryAccess = {
	outputs?: PiOutputArchive;
	entries: PiSdk.SessionEntry[];
	list: (
		signal: AbortSignal,
		referencesOnly?: boolean,
	) => Promise<SessionSummary[]>;
	target: (id: string) => PiResumeTarget;
	readContext?: (
		id: string,
		mode: "transcript" | "handoff",
		signal: AbortSignal,
	) => Promise<string>;
};

/** 保存設定に応じて、ワークスペース内または `agentDir` 配下の保存先を返す。 */
export function piSessionDirectory(
	cwd: string,
	agentDir: string,
	storage: PiSessionStorage,
): string {
	return storage === "workspace"
		? join(cwd, ".pi", "sessions")
		: join(
				agentDir,
				"sessions",
				`--${resolve(cwd)
					.replace(/^[/\\]/, "")
					.replace(/[/\\:]/g, "-")}--`,
			);
}

/** ワークスペース保存時は初回だけ `.gitignore` を作り、作成権限エラーを握りつぶさない。 */
export async function preparePiSessionDirectory(
	directory: string,
	storage: PiSessionStorage,
): Promise<void> {
	await mkdir(directory, { recursive: true });
	if (storage === "workspace") {
		try {
			await writeFile(join(directory, ".gitignore"), "*\n", {
				flag: "wx",
			});
		} catch (error) {
			if (!(
				error instanceof Error &&
				"code" in error &&
				error.code === "EEXIST"
			)) {
				throw error;
			}
		}
	}
}

/** 一覧と復元を同じ保存先に限定し、移動したワークスペースでは現在の `cwd` を使用する。 */
export async function openPiSessionStore(
	sdk: typeof PiSdk,
	cwd: string,
	agentDir: string,
	storage: PiSessionStorage,
	signal: AbortSignal,
	resume?: PiResumeTarget,
) {
	const directory =
		resume?.directory ?? piSessionDirectory(cwd, agentDir, storage);
	storage = resume?.storage ?? storage;
	await preparePiSessionDirectory(directory, storage);
	signal.throwIfAborted();
	const root = await realpath(directory);
	/** ディレクトリ移動に追従しつつ、外部ファイルへのリンクは履歴に含めない。 */
	const list = createPiHistoryListing(directory, storage, sdk, cwd, root);
	let manager: PiSdk.SessionManager;
	if (resume) {
		const matches = (await list(signal)).filter(
			(row) => row.id === resume.id,
		);
		if (matches.length !== 1) {
			throw new Error(
				"Piの履歴が見つからないか、IDが重複しています。一覧を更新してください。",
			);
		}
		const path = matches[0]!.path;
		// `SessionManager.open` は空ファイルを初期化するため、読み込み前に有効なヘッダーを確認する。
		const header = await readPiSessionHeader(path, signal);
		if (header.id !== resume.id) {
			throw new Error("Piの履歴ファイルが変更されています。");
		}
		signal.throwIfAborted();
		manager = sdk.SessionManager.open(path, directory, cwd);
		forkSessionStore(resume, manager);
	} else {
		manager = sdk.SessionManager.create(cwd, directory);
	}
	const history: PiHistoryAccess = {
		outputs: new PiOutputArchive(manager, root),
		readContext: createPiContextReader(list, cwd, manager, sdk, directory),
		entries: manager.getBranch(),
		target: (id) => ({ id, directory, storage }),
		list: async (listSignal, referencesOnly = false) =>
			(await list(listSignal))
				.filter((row) => !referencesOnly || sameCwd(row.cwd, cwd))
				.map((row) => ({
					sessionId: row.id,
					cwd,
					title:
						nonEmptyString(row.name?.trim()) ??
						nonEmptyString(row.firstMessage.trim().slice(0, 120)) ??
						"Piの会話",
					updatedAt: row.modified.toISOString(),
				})),
	};
	return { manager, history };
}

/** 参照前後のファイルと実行状態を照合し、他の会話の安全な資料だけを返す。 */
function createPiContextReader(
	list: (listSignal: AbortSignal) => Promise<PiSdk.SessionInfo[]>,
	cwd: string,
	manager: PiSdk.SessionManager,
	sdk: typeof PiSdk,
	directory: string,
): (
	id: string,
	mode: "transcript" | "handoff",
	signal: AbortSignal,
) => Promise<string> {
	return async (id, mode, readSignal) => {
		assertPiReferenceIdle(id);
		const matches = (await list(readSignal)).filter(
			(row) => row.id === id && sameCwd(row.cwd, cwd),
		);
		if (matches.length !== 1 || id === manager.getSessionId()) {
			throw new Error("参照セッションを選び直してください。");
		}
		const file = matches[0]!.path;
		const before = await readFile(file, "utf8");
		if (Buffer.byteLength(before) > 2000000) {
			throw new Error("参照セッションが大きすぎます。");
		}
		const header = sdk.parseSessionEntries(before)[0];
		if (
			header?.type !== "session" ||
			header.id !== id ||
			!sameCwd(header.cwd, cwd)
		) {
			throw new Error("参照セッションが変更されています。");
		}
		readSignal.throwIfAborted();
		const source = sdk.SessionManager.open(file, directory);
		const context = piSessionContext(sdk, source.getBranch(), mode);
		if ((await readFile(file, "utf8")) !== before) {
			throw new Error("参照セッションが変更されています。");
		}
		readSignal.throwIfAborted();
		assertPiReferenceIdle(id);
		return context;
	};
}

/** 現在の保存ディレクトリ内に実体がある履歴だけを一覧に含める。 */
function createPiHistoryListing(
	directory: string,
	storage: PiSessionStorage,
	sdk: typeof PiSdk,
	cwd: string,
	root: string,
) {
	return async (listSignal: AbortSignal) => {
		await readdir(directory);
		const rows =
			storage === "workspace"
				? await sdk.SessionManager.listAll(
						directory,
						undefined,
						listSignal,
					)
				: await sdk.SessionManager.list(
						cwd,
						directory,
						undefined,
						listSignal,
					);
		const safe = [];
		for (const row of rows) {
			listSignal.throwIfAborted();
			try {
				if (dirname(await realpath(row.path)) === root) {
					safe.push(row);
				}
			} catch {
				/* 一覧取得中に削除された履歴は省く。 */
			}
		}
		return safe;
	};
}

/** 別パネルで処理中の会話を参照資料として読み込まない。 */
function assertPiReferenceIdle(id: string) {
	if (isPiSessionRunning(id)) {
		throw new Error("実行中の Pi セッションは参照できません。");
	}
}

/** 元の履歴を保って選択ブランチを別会話へ複製する。 */
function forkSessionStore(
	resume: PiResumeTarget,
	manager: PiSdk.SessionManager,
) {
	if (resume.fork === true) {
		const leaf = manager.getLeafId();
		if (!isNonEmptyString(leaf)) {
			throw new Error("空のPi履歴はフォークできません。");
		}
		// SDK はこの `manager` だけを新しい ID・ファイルへ切り替える。
		manager.createBranchedSession(leaf);
	}
}

// Pi標準のJSONLを保存し、選択した保存先の履歴だけを公開する。
import {
	mkdir,
	readFile,
	readdir,
	realpath,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type * as PiSdk from "@earendil-works/pi-coding-agent";
import type { SessionSummary } from "../../../shared/sessionHistory";

/** 保存先の設定値。任意パスはWebviewから受け取らない。 */
export type PiSessionStorage = "global" | "workspace";
/** 一覧を取得したHostが保持し、復元先の保存領域を固定する。 */
export type PiResumeTarget = {
	id: string;
	directory: string;
	storage: PiSessionStorage;
	/** 元のファイルを保持し、選択ブランチを別の会話へ複製する。 */
	fork?: boolean;
};
/** SDKから独立した履歴一覧と初期表示の境界。 */
export type PiHistoryAccess = {
	entries: PiSdk.SessionEntry[];
	list: (signal: AbortSignal) => Promise<SessionSummary[]>;
	target: (id: string) => PiResumeTarget;
};

/** SDK 0.86の標準配置に合わせ、指定したagentDirも尊重する。 */
export function piSessionDirectory(
	cwd: string,
	agentDir: string,
	storage: PiSessionStorage,
): string {
	return storage === "workspace"
		? join(cwd, ".sessions")
		: join(
				agentDir,
				"sessions",
				`--${resolve(cwd)
					.replace(/^[/\\]/, "")
					.replace(/[/\\:]/g, "-")}--`,
			);
}

/** 初回だけignoreを作り、既存設定や作成権限エラーを握りつぶさない。 */
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

/** 一覧と復元を同じ保存先に限定し、移動したworkspaceでは現在のcwdを使用する。 */
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
	const list = async (listSignal: AbortSignal) => {
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
		// SDK.openは空ファイルを初期化するため、読込前に有効なヘッダーを確認する。
		const header = sdk.parseSessionEntries(await readFile(path, "utf8"))[0];
		if (header?.type !== "session" || header.id !== resume.id) {
			throw new Error("Piの履歴ファイルが変更されています。");
		}
		signal.throwIfAborted();
		manager = sdk.SessionManager.open(path, directory, cwd);
		if (resume.fork) {
			const leaf = manager.getLeafId();
			if (!leaf) {
				throw new Error("空のPi履歴はフォークできません。");
			}
			// SDKはこのmanagerだけを新しいID・ファイルへ切り替える。
			manager.createBranchedSession(leaf);
		}
	} else {
		manager = sdk.SessionManager.create(cwd, directory);
	}
	const history: PiHistoryAccess = {
		entries: manager.getBranch(),
		target: (id) => ({ id, directory, storage }),
		list: async (listSignal) =>
			(await list(listSignal)).map((row) => ({
				sessionId: row.id,
				cwd,
				title:
					row.name?.trim() ||
					row.firstMessage.trim().slice(0, 120) ||
					"Piの会話",
				updatedAt: row.modified.toISOString(),
			})),
	};
	return { manager, history };
}

// ユーザーの Codex を優先し、同意がある場合だけ対応版を専用領域へ取得する。
import * as vscode from "vscode";
import { join } from "node:path";
import { hostStorageRoot } from "../../../session/HostStorage";
import { readCodexRelease, type CodexRelease } from "./CodexRelease";
import { codexVersion, findInstalledCodex } from "./installedCodex";
import { installCodex, cachedCodex } from "./downloadCodex";

/** 明示した実体は Host が解決する。Webview や設定値を直接渡さない。 */
export type CodexExecutableOptions =
	{ extensionPath: string } | { executable: string };

const pending = new Map<string, Promise<string>>();

/** 同一 Host 内の信頼確認・会話開始で、同意ダイアログと取得を重複させない。 */
export function resolveCodexExecutable(extensionPath: string): Promise<string> {
	const existing = pending.get(extensionPath);
	if (existing) {
		return existing;
	}
	const resolving = resolveRuntime(extensionPath).finally(() =>
		pending.delete(extensionPath),
	);
	pending.set(extensionPath, resolving);
	return resolving;
}

/** 不一致を接続前に拒否し、古い CLI で設定変更やモデル実行を始めない。 */
async function resolveRuntime(extensionPath: string): Promise<string> {
	if (process.platform !== "win32" || process.arch !== "x64") {
		throw new Error("Codex App Server の実行には Windows x64 が必要です。");
	}
	const release = await readCodexRelease(extensionPath);
	const installed = await findInstalledCodex();
	let version: string | undefined;
	if (installed !== undefined) {
		version = await codexVersion(installed);
		if (version === release.version) {
			return installed;
		}
		if (olderVersion(version, release.version)) {
			const message = `Codex ${version} は古いため利用できません。${release.version} に更新し、Nerita へ再接続してください。`;
			void vscode.window.showErrorMessage(message);
			throw new Error(message);
		}
	}
	// ユーザー側の更新不足を専用版で迂回せず、未導入・新しい版の場合だけキャッシュを使う。
	const storage = join(
		hostStorageRoot(),
		"codex",
		release.version,
		"win32-x64",
	);
	const cached = await cachedCodex(storage, release);
	if (cached !== undefined) {
		return cached;
	}
	const accepted = await confirmDownload(release, storage, version);
	if (!accepted) {
		throw new Error(
			"対応する Codex のダウンロードが必要です。再接続から再試行できます。",
		);
	}
	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Codex ${release.version} を取得`,
			cancellable: true,
		},
		async (_progress, token) => {
			const abort = new AbortController();
			const subscription = token.onCancellationRequested(() =>
				abort.abort(),
			);
			if (token.isCancellationRequested) {
				abort.abort();
			}
			try {
				return await installCodex(storage, release, abort.signal);
			} finally {
				subscription.dispose();
			}
		},
	);
}

/** パッチ・マイナー・メジャーの桁数に依存せず安定版を比較する。 */
function olderVersion(installed: string, required: string): boolean {
	const parts = installed.split(".").map(Number);
	const target = required.split(".").map(Number);
	for (let index = 0; index < target.length; index++) {
		if (parts[index] !== target[index]) {
			return parts[index]! < target[index]!;
		}
	}
	return false;
}

/** 取得する版・容量・配布元・保存先を表示し、既存 CLI を上書きしないことを伝える。 */
async function confirmDownload(
	release: CodexRelease,
	storage: string,
	installed?: string,
): Promise<boolean> {
	const reason =
		installed === undefined
			? "Codex がインストールされていません。"
			: `インストール済みの Codex ${installed} は、この Nerita の対応版より新しいため利用できません。`;
	const accepted = await vscode.window.showInformationMessage(
		`${reason} 対応版 ${release.version} をダウンロードしますか？`,
		{
			modal: true,
			detail: `展開後の容量: 約 ${Math.ceil(release.runtime.unpackedSize / 1048576)} MiB\n取得元: ${release.runtime.url}\n保存先: ${storage}\n既存の Codex は上書きしません。音声・Code Mode・Sandbox の資産も取得します。`,
		},
		"ダウンロード",
	);
	return accepted === "ダウンロード";
}

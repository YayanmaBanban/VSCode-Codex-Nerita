// Codex の設定 RPC で信頼を読み書きし、Nerita の保存領域へ信頼値を複製しない。
import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { CodexClient } from "../CodexClient";
import type { TrustReply } from "@nerita/shared/workspaceTrust";
import {
	trustKey,
	type TrustRecord,
} from "../../../security/trust/WorkspaceTrustStore";
import { containsPath } from "../../../security/AgentAccessPolicy";

const execute = promisify(execFile);
/** Windows の区切り文字と大小文字の違いを同じ設定対象として扱う。 */
function projectKey(root: string): string {
	return trustKey(resolve(root));
}
/** 未設定は明示的な非信頼と区別して保存・表示する。 */
type TrustLevel = "trusted" | "untrusted" | "unset";

/** 接続は操作ごとに回収し、モデル認証や thread/start を信頼操作に使わない。 */
export class CodexWorkspaceTrust {
	private roots = new Set<string>();
	private contexts = new Map<string, { cwd: string; project: string }>();
	private queue: Promise<void> = Promise.resolve();
	private restricting = 0;
	private failed = false;
	private revision = 0;
	/** 通知先は Host が所有し、信頼設定の変更で既存接続を無効化する。 */
	constructor(
		private readonly extensionPath: string,
		private readonly changed: (root?: string) => void,
	) {}

	/** 保存待ちの取消しや取得失敗を実行許可へ変換しない。 */
	async trusted(root: string): Promise<boolean> {
		const revision = this.revision;
		if (this.restricting > 0 || this.failed) {
			return false;
		}
		try {
			const cwd = await realpath(root);
			const key = await projectRoot(cwd);
			this.contexts.set(trustKey(cwd), { cwd, project: key });
			const trusted = await this.withClient(async (client) => {
				const config = await client.readTrustConfig(cwd);
				const direct = Object.entries(config.projects).filter(
					([path]) => projectKey(path) === projectKey(cwd),
				);
				const projects =
					direct.length > 0
						? direct
						: Object.entries(config.projects).filter(
								([path]) =>
									projectKey(path) === projectKey(key),
							);
				// 矛盾する別表記を、取得順によって実行許可へ変換しない。
				const explicit = projects.filter(
					([, project]) => typeof project.trust_level === "string",
				);
				return (
					explicit.length > 0 &&
					explicit.every(
						([, project]) => project.trust_level === "trusted",
					)
				);
			});
			return trusted && revision === this.revision;
		} catch {
			return false;
		}
	}

	/** 未設定のフォルダも一覧へ加えるが、読取りだけで Codex の設定は変更しない。 */
	async registerWorkspace(root: string): Promise<void> {
		this.roots.add(await realpath(root));
	}

	/** Codex には更新日時がないため、UI へ架空の日時を渡さない。 */
	async list(): Promise<TrustReply["records"]> {
		let pending: Promise<void>;
		do {
			pending = this.queue;
			await pending;
		} while (pending !== this.queue);
		return this.withClient((client) => this.readRecords(client));
	}
	/** 設定上の明示値と、UI で選択した未設定フォルダを合わせて返す。 */
	private async readRecords(
		client: CodexClient,
	): Promise<TrustReply["records"]> {
		const { projects } = await client.readTrustConfig();
		const records = new Map<string, TrustReply["records"][number]>();
		for (const [root, project] of Object.entries(projects)) {
			if (typeof project.trust_level === "string") {
				// 異なる表記の設定値を潰さず表示し、矛盾をユーザーが確認できるようにする。
				records.set(root, {
					root,
					trust: project.trust_level,
					origin: "workspace",
					updatedAt: null,
				});
			}
		}
		for (const root of this.roots) {
			const exists = [...records.keys()].some(
				(path) => projectKey(path) === projectKey(root),
			);
			if (!exists) {
				records.set(root, {
					root,
					trust: "unset",
					origin: "workspace",
					updatedAt: null,
				});
			}
		}
		return [...records.values()];
	}

	/** 信頼の解除は明示的な非信頼として保存し、記録の削除では `trust_level` を未設定にする。 */
	change(
		root: string,
		trust: TrustLevel,
		expected?: TrustRecord["identity"],
	): Promise<void> {
		this.restricting++;
		this.revision++;
		this.notify(root);
		/** 保存を直列化し、成功後だけ一覧用の未設定ルートを除外する。 */
		const save = async () => {
			await this.withClient((client) =>
				this.writeTrust(client, root, trust, expected),
			);
			this.failed = false;
			if (trust === "unset") {
				for (const registered of this.roots) {
					if (projectKey(registered) === projectKey(root)) {
						this.roots.delete(registered);
					}
				}
			}
		};
		const action = this.queue
			.then(save)
			.catch((error: unknown) => {
				this.failed = true;
				throw error;
			})
			.finally(() => {
				this.restricting--;
				this.revision++;
				this.notify(this.failed ? undefined : root);
			});
		this.queue = action.catch(() => {});
		return action;
	}
	/** 元リポジトリから信頼を継承する Worktree にも変更を通知する。 */
	private notify(root?: string): void {
		if (root === undefined) {
			this.changed();
			return;
		}
		this.changed(root);
		for (const context of this.contexts.values()) {
			const inherits = trustKey(context.project) === trustKey(root);
			const directlyAffected =
				containsPath(root, context.cwd) ||
				containsPath(context.cwd, root);
			if (inherits && !directlyAffected) {
				this.changed(context.cwd);
			}
		}
	}
	/** 昇格は存在するディレクトリだけを受け付け、書込み後の上書き状態も確認する。 */
	private async writeTrust(
		client: CodexClient,
		root: string,
		trust: TrustLevel,
		expected?: TrustRecord["identity"],
	): Promise<void> {
		if (trust === "trusted") {
			const info = await stat(root);
			if (!info.isDirectory()) {
				throw new Error("信頼する対象にはフォルダを指定してください。");
			}
			const identity = {
				dev: info.dev,
				ino: info.ino,
				birthtimeMs: info.birthtimeMs,
			};
			const replaced =
				expected !== undefined &&
				JSON.stringify(identity) !== JSON.stringify(expected);
			if (replaced) {
				throw new Error(
					"信頼の確認中に対象が変更されました。もう一度確認してください。",
				);
			}
		}
		const { projects } = await client.readTrustConfig();
		// 正規化したキーだけに信頼値を残し、同じパスを指す別表記の `trust_level` を解除する。
		const aliases = Object.keys(projects).filter(
			(path) => projectKey(path) === projectKey(root),
		);
		const result = await client.writeProjectTrust(
			projectKey(root),
			trust === "unset" ? null : trust,
			aliases,
		);
		if (result.status !== "ok") {
			throw new Error(
				"Codex の信頼設定は上位の設定で上書きされています。",
			);
		}
	}

	/** グローバル設定の取得はプロジェクト設定を読み込まない作業場所から接続する。 */
	private async withClient<T>(
		action: (client: CodexClient) => Promise<T>,
	): Promise<T> {
		const client = await CodexClient.connect({
			extensionPath: this.extensionPath,
			cwd: this.extensionPath,
			clientInfo: {
				name: "nerita_codex_trust",
				title: "Nerita Trust",
				version: "0.0.1",
			},
		});
		try {
			return await action(client);
		} finally {
			await client.dispose();
		}
	}
}

/** Worktree では共通 Git ディレクトリから元リポジトリの信頼キーを求める。 */
async function projectRoot(cwd: string): Promise<string> {
	try {
		const result = await execute(
			"git",
			[
				"-C",
				cwd,
				"rev-parse",
				"--path-format=absolute",
				"--git-common-dir",
			],
			{ windowsHide: true, timeout: 10000 },
		);
		return await realpath(dirname(resolve(cwd, result.stdout.trim())));
	} catch {
		return cwd;
	}
}

// 現在の通常チャットの作業ツリーだけを対象に、Git と読み取り専用プレビューを提供する。
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { open, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
	isRemoteFilePath,
	type RemoteFilesReply,
	type RemoteFilesRequest,
} from "@nerita/shared/remote/files";
import { RemoteError } from "./RemoteError";

const exec = promisify(execFile);
const byteLimit = 128 * 1024;

/** インデックス操作とネットワーク送信は共有の一件ずつ実行する。 */
export class RemoteFiles {
	private modifying = false;

	/** 対象を確定してから、認証とセッションが継続していることを確認する。 */
	async apply(
		request: RemoteFilesRequest,
		cwd: string,
		authorize: () => void,
	): Promise<RemoteFilesReply> {
		const mutation = request.type !== "list" && request.type !== "read";
		if (mutation && this.modifying) {
			throw new RemoteError("backend_switch_busy");
		}
		if (mutation) {
			this.modifying = true;
		}
		try {
			const root = await realpath(
				(await git(cwd, ["rev-parse", "--show-toplevel"])).trim(),
			);
			const scope = await realpath(cwd);
			if (relative(root, scope) !== "") {
				throw new RemoteError("forbidden");
			}
			const result = await this.readOrApply(request, root, authorize);
			authorize();
			return result;
		} finally {
			if (mutation) {
				this.modifying = false;
			}
		}
	}

	/** ファイルは毎回 Git の現在の変更一覧にある項目と照合する。 */
	private async readOrApply(
		request: RemoteFilesRequest,
		root: string,
		authorize: () => void,
	): Promise<RemoteFilesReply> {
		if (request.type === "push") {
			await push(root, request, authorize);
			return { type: "done" };
		}
		if (request.type === "commit") {
			await commit(root, request, authorize);
			return { type: "done" };
		}
		const files = await changes(root);
		authorize();
		if (request.type === "list") {
			const target = await pushTarget(root).catch(() => null);
			const push =
				target === null
					? null
					: { head: target.head, destination: target.destination };
			return { type: "list", files, push, index: await indexState(root) };
		}
		const file = files.find((item) => item.path === request.path);
		if (!file) {
			throw new RemoteError("invalid_request");
		}
		if (request.type === "read") {
			return {
				type: "file",
				path: file.path,
				text: await preview(root, file.path),
			};
		}
		if (!file.canStage) {
			throw new RemoteError("invalid_request");
		}
		await git(root, ["--literal-pathspecs", "add", "--", file.path]);
		return { type: "done" };
	}
}

/** Git 設定や認証の詳細をブラウザーへ返さず、引数をシェルに渡さない。 */
async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await exec("git", ["--no-optional-locks", ...args], {
		cwd,
		windowsHide: true,
		encoding: "utf8",
		maxBuffer: 2 * 1024 * 1024,
		timeout: 20_000,
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	});
	return stdout;
}

/** 区切りは NUL とし、ファイル名の空白をそのまま扱う。 */
async function changes(root: string) {
	const status = await git(root, [
		"status",
		"--porcelain=v1",
		"-z",
		"--no-renames",
		"--untracked-files=all",
	]);
	return status
		.split("\0")
		.flatMap((line) => {
			const path = line.slice(3);
			if (!isRemoteFilePath(path)) {
				return [];
			}
			const status = line.slice(0, 2);
			const conflict = /^(?:DD|AU|UD|UA|DU|AA|UU)$/u.test(status);
			return [{ path, status, canStage: status[1] !== " " && !conflict }];
		})
		.slice(0, 200);
}

/** リポジトリ内の通常テキストだけを、固定サイズまで読み取る。 */
async function preview(root: string, path: string): Promise<string> {
	const expected = resolve(root, path);
	const absolute = await realpath(expected);
	if (relative(expected, absolute) !== "") {
		throw new RemoteError("forbidden");
	}
	const file = await open(absolute, "r");
	try {
		const info = await file.stat();
		if (!info.isFile() || info.size > byteLimit) {
			throw new RemoteError("invalid_request");
		}
		const bytes = Buffer.alloc(info.size);
		const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
		const content = bytes.subarray(0, bytesRead);
		if (content.includes(0)) {
			throw new RemoteError("invalid_request");
		}
		return new TextDecoder("utf-8", { fatal: true }).decode(content);
	} finally {
		await file.close();
	}
}

/** 現ブランチの上流と HEAD を取得し、接続先 URL を返さない。 */
async function pushTarget(root: string) {
	const refs = await git(root, [
		"for-each-ref",
		"--points-at=HEAD",
		"--format=%(HEAD)%00%(objectname)%00%(upstream:remotename)%00%(upstream:remoteref)",
		"refs/heads",
	]);
	const active = refs.split("\n").find((line) => line.startsWith("*\0"));
	const [, head, remote, ref] = active?.trimEnd().split("\0") ?? [];
	const validRemote = remote !== undefined && /^\w[\w.-]*$/u.test(remote);
	const validRef = ref?.startsWith("refs/heads/") === true;
	if (!validRemote || head === undefined || !validRef) {
		return null;
	}
	return {
		head,
		destination: `${remote}/${ref.slice("refs/heads/".length)}`,
		remote,
		ref,
	};
}

/** 現在のブランチとステージ済みの内容を、表示時の状態として識別する。 */
async function indexState(root: string): Promise<string | null> {
	const diff = await git(root, [
		"diff",
		"--cached",
		"--no-ext-diff",
		"--raw",
		"--no-abbrev",
		"-z",
	]);
	if (diff === "") {
		return null;
	}
	const branch = await git(root, [
		"rev-parse",
		"--symbolic-full-name",
		"HEAD",
	]).catch(() => "");
	return createHash("sha256").update(branch).update(diff).digest("hex");
}

/** 確認後にステージ内容が変わった場合は取り込みを拒否する。 */
async function commit(
	root: string,
	request: Extract<RemoteFilesRequest, { type: "commit" }>,
	authorize: () => void,
) {
	const index = await indexState(root);
	if (index !== request.index) {
		throw new RemoteError("stale_session");
	}
	authorize();
	await git(root, ["commit", "-m", request.message]);
}

/** 上流とコミットが確認時のままなら、指定コミットを通常の更新として送る。 */
async function push(
	root: string,
	request: Extract<RemoteFilesRequest, { type: "push" }>,
	authorize: () => void,
) {
	const target = await pushTarget(root);
	const sameCommit = target?.head === request.head;
	if (!sameCommit || target.destination !== request.destination) {
		throw new RemoteError("stale_session");
	}
	authorize();
	await git(root, [
		"push",
		"--no-follow-tags",
		"--",
		target.remote,
		`${target.head}:${target.ref}`,
	]);
}

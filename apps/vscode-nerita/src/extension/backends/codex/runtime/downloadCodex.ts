// 固定ハッシュの公式 npm 資産を検証し、完成した Codex だけを専用領域へ公開する。
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { z } from "zod";
import { fsErrorCode } from "../../../runtime/FsError";
import type { CodexRelease } from "./CodexRelease";
import { codexVersion } from "./installedCodex";

const execute = promisify(execFile);
const vendor = "vendor/x86_64-pc-windows-msvc";
const executablePath = `${vendor}/bin/codex.exe`;
const readySchema = z.object({ version: z.string(), integrity: z.string() });

/** 音声・Code Mode・Sandbox を含む配布一式を、公開前と再利用前に確認する。 */
async function validateRuntime(
	root: string,
	release: CodexRelease,
): Promise<string> {
	for (const relative of [
		executablePath,
		`${vendor}/bin/codex-code-mode-host.exe`,
		`${vendor}/codex-path/rg.exe`,
		`${vendor}/codex-resources/codex-command-runner.exe`,
		`${vendor}/codex-resources/codex-windows-sandbox-setup.exe`,
		`${vendor}/codex-resources/voice/bin/codex-voice-host.exe`,
	]) {
		await access(path.join(root, relative));
	}
	const executable = path.join(root, executablePath);
	const version = await codexVersion(executable);
	if (version !== release.version) {
		throw new Error("取得した Codex のバージョンが対応版と一致しません。");
	}
	return executable;
}

/** 中断された取得や旧版を利用可能と扱わず、完成記録と本体の版を照合する。 */
export async function cachedCodex(
	storage: string,
	release: CodexRelease,
): Promise<string | undefined> {
	try {
		const ready = readySchema.parse(
			JSON.parse(
				await readFile(path.join(storage, "ready.json"), "utf8"),
			),
		);
		const matches =
			ready.version === release.version &&
			ready.integrity === release.runtime.integrity;
		if (!matches) {
			throw new Error("保存済み Codex の配布情報が一致しません。");
		}
		return await validateRuntime(storage, release);
	} catch (error) {
		if (fsErrorCode(error) === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}

/** ハッシュが一致するまで展開せず、中断や失敗で既存の完成版を変更しない。 */
export async function installCodex(
	storage: string,
	release: CodexRelease,
	signal: AbortSignal,
): Promise<string> {
	signal.throwIfAborted();
	await mkdir(path.dirname(storage), { recursive: true });
	const parent = await realpath(path.dirname(storage));
	const destination = path.join(parent, path.basename(storage));
	const staging = await mkdtemp(path.join(parent, ".download-"));
	try {
		const archive = path.join(staging, "codex.tgz");
		await downloadArchive(archive, release, signal);
		await extractArchive(archive, staging, signal);
		const root = path.join(staging, "package");
		await validateRuntime(root, release);
		await writeFile(
			path.join(root, "ready.json"),
			JSON.stringify({
				version: release.version,
				integrity: release.runtime.integrity,
			}),
		);
		signal.throwIfAborted();
		try {
			await rename(root, destination);
		} catch (error) {
			// 別の VS Code ウィンドウが先に同じ完成版を公開した場合だけ、その版を再利用する。
			const existing = await cachedCodex(destination, release);
			if (existing === undefined) {
				throw error;
			}
			return existing;
		}
		return path.join(destination, executablePath);
	} finally {
		// 実際のパスを解決した親ディレクトリ内で、この処理が作った一時領域だけを削除する。
		await rm(staging, { recursive: true, force: true });
	}
}

/** 取得容量を制限し、展開前に生成器が固定した SHA-512 と照合する。 */
async function downloadArchive(
	file: string,
	release: CodexRelease,
	caller: AbortSignal,
): Promise<void> {
	const signal = AbortSignal.any([
		caller,
		AbortSignal.timeout(10 * 60 * 1000),
	]);
	const response = await fetch(release.runtime.url, {
		signal,
		redirect: "error",
	});
	if (!response.ok || !response.body) {
		throw new Error(`Codex の取得に失敗しました: HTTP ${response.status}`);
	}
	let bytes = 0;
	const limit = release.runtime.unpackedSize + 1048576;
	const counter = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			bytes += chunk.length;
			callback(
				bytes > limit
					? new Error("Codex の取得サイズが上限を超えました。")
					: null,
				chunk,
			);
		},
	});
	await pipeline(
		Readable.from(responseChunks(response.body)),
		counter,
		createWriteStream(file, { flags: "wx" }),
		{ signal },
	);
	const digest = createHash("sha512");
	await pipeline(createReadStream(file), digest, { signal });
	if (`sha512-${digest.digest("base64")}` !== release.runtime.integrity) {
		throw new Error(
			"Codex のハッシュが一致しないため、取得したファイルを破棄しました。",
		);
	}
}

/** DOM と Node の Stream 型の違いを持ち込まず、取得データを逐次ファイルへ流す。 */
async function* responseChunks(body: NonNullable<Response["body"]>) {
	const reader = body.getReader();
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) {
				return;
			}
			yield chunk.value;
		}
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
}

/** リンクや領域外パスを拒否してから、Windows 標準の tar で展開する。 */
async function extractArchive(
	archive: string,
	destination: string,
	signal: AbortSignal,
): Promise<void> {
	if (process.env.SystemRoot === undefined) {
		throw new Error("Windows の展開コマンドを見つけられません。");
	}
	const tar = path.join(process.env.SystemRoot, "System32/tar.exe");
	const options = { windowsHide: true, signal, maxBuffer: 4 * 1024 * 1024 };
	const listing = await execute(tar, ["-tzf", archive], options);
	for (const name of listing.stdout.trim().split(/\r?\n/)) {
		const unsafeCharacters = name.includes("\\") || name.includes(":");
		const invalid =
			!name.startsWith("package/") ||
			unsafeCharacters ||
			name.split("/").includes("..");
		if (invalid) {
			throw new Error("Codex のアーカイブに不正なパスがあります。");
		}
	}
	const types = await execute(tar, ["-tvzf", archive], options);
	const safeTypes = types.stdout
		.trim()
		.split(/\r?\n/)
		.every((line) => line.startsWith("-") || line.startsWith("d"));
	if (!safeTypes) {
		throw new Error(
			"Codex のアーカイブにリンクや未対応のファイルがあります。",
		);
	}
	await execute(tar, ["-xzf", archive, "-C", destination], options);
}

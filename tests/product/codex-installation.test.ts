// 既存 CLI の優先・不一致の拒否・同意とハッシュ検証を、実ファイルと OS 境界で確認する。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { resolveCodexExecutable } from "../../apps/vscode-nerita/src/extension/backends/codex/runtime/executable";
import { findInstalledCodex } from "../../apps/vscode-nerita/src/extension/backends/codex/runtime/installedCodex";
import { installCodex } from "../../apps/vscode-nerita/src/extension/backends/codex/runtime/downloadCodex";
import { CodexClient } from "../../apps/vscode-nerita/src/extension/backends/codex/CodexClient";
import { codexArchive, codexInstallation } from "../support/codexInstallation";

void test("対応版の既存 Codex をダウンロードも同意要求も行わず再利用する", async (t) => {
	const f = await codexInstallation(t, "0.164.0");
	const network = t.mock.method(globalThis, "fetch", () =>
		Promise.reject(new Error("network forbidden")),
	);
	assert.equal(
		await resolveCodexExecutable(f.extension),
		join(f.installed, "codex.exe"),
	);
	assert.equal(f.prompts(), 0);
	assert.equal(network.mock.callCount(), 0);
});

void test("古い Codex は更新を通知し、接続開始と専用版への迂回を拒否する", async (t) => {
	const f = await codexInstallation(t, "0.163.0");
	const network = t.mock.method(globalThis, "fetch", () =>
		Promise.reject(new Error("network forbidden")),
	);
	await assert.rejects(
		CodexClient.connect({
			extensionPath: f.extension,
			cwd: f.root,
			clientInfo: { name: "fixture", title: null, version: "1" },
		}),
	);
	assert.equal(f.outdated(), 1);
	assert.equal(f.prompts(), 0);
	assert.equal(network.mock.callCount(), 0);
	await assert.rejects(access(join(f.installed, "started.txt")), {
		code: "ENOENT",
	});
	await writeFile(join(f.installed, "version.txt"), "0.164.0");
	assert.equal(
		await resolveCodexExecutable(f.extension),
		join(f.installed, "codex.exe"),
	);
});

void test("新しい Codex の取得同意を断ると通信せず、再接続時に再び選べる", async (t) => {
	const f = await codexInstallation(t, "0.200.0");
	const network = t.mock.method(globalThis, "fetch", () =>
		Promise.reject(new Error("network forbidden")),
	);
	await assert.rejects(resolveCodexExecutable(f.extension));
	await assert.rejects(resolveCodexExecutable(f.extension));
	assert.equal(f.prompts(), 2);
	assert.equal(network.mock.callCount(), 0, "同意を得る前に通信しない");
	assert.equal(
		await readFile(join(f.installed, "version.txt"), "utf8"),
		"0.200.0",
	);
});

for (const version of [undefined, "0.200.0"]) {
	void test(`Codex が${version === undefined ? "未導入" : "対応版より新しい"}場合は同意後だけ取得し、次回は完成版を再利用する`, async (t) => {
		const f = await codexInstallation(t, version);
		const bytes = await codexArchive(f);
		const network = t.mock.method(globalThis, "fetch", () =>
			Promise.resolve(new Response(bytes)),
		);
		f.consent.accepted = true;
		const [first, concurrent] = await Promise.all([
			resolveCodexExecutable(f.extension),
			resolveCodexExecutable(f.extension),
		]);
		assert.equal(first, concurrent);
		assert.equal(await resolveCodexExecutable(f.extension), first);
		assert.notEqual(first, join(f.installed, "codex.exe"));
		assert.equal(
			f.prompts(),
			1,
			"同意と取得は同時接続や再接続で重複しない",
		);
		assert.equal(network.mock.callCount(), 1);
		assert.equal(
			await readFile(
				join(dirname(first), "codex-code-mode-host.exe"),
				"utf8",
			),
			"fixture-asset",
		);
		if (version !== undefined) {
			assert.equal(
				await readFile(join(f.installed, "version.txt"), "utf8"),
				version,
			);
		}
	});
}

void test("ハッシュ不一致の取得物は実行せず破棄し、再試行を妨げない", async (t) => {
	const f = await codexInstallation(t);
	const bytes = await codexArchive(f);
	const storage = join(f.root, "cache/runtime");
	const integrity = f.release.runtime.integrity;
	f.release.runtime.integrity = `sha512-${createHash("sha512").update("different").digest("base64")}`;
	t.mock.method(globalThis, "fetch", () =>
		Promise.resolve(new Response(bytes)),
	);
	await assert.rejects(
		installCodex(storage, f.release, new AbortController().signal),
		"ハッシュ不一致の資産を実行しない",
	);
	await assert.rejects(access(storage), { code: "ENOENT" });
	assert.deepEqual(await readdir(dirname(storage)), []);
	f.release.runtime.integrity = integrity;
	await access(
		await installCodex(storage, f.release, new AbortController().signal),
	);
});

void test("取得の中断と HTTP 失敗では完成版や一時ファイルを残さない", async (t) => {
	const f = await codexInstallation(t);
	const storage = join(f.root, "cache/runtime");
	const abort = new AbortController();
	abort.abort();
	const network = t.mock.method(globalThis, "fetch", () =>
		Promise.resolve(new Response("unavailable", { status: 503 })),
	);
	await assert.rejects(installCodex(storage, f.release, abort.signal));
	assert.equal(network.mock.callCount(), 0);
	await assert.rejects(
		installCodex(storage, f.release, new AbortController().signal),
	);
	assert.deepEqual(await readdir(dirname(storage)), []);
});

for (const entry of [
	{ name: "package/../../outside", type: "0" },
	{ name: "package/link", type: "2" },
]) {
	void test(`ハッシュが正しくても不正なアーカイブを展開しない: ${entry.name}`, async (t) => {
		const f = await codexInstallation(t);
		const header = Buffer.alloc(512);
		header.write(entry.name);
		header.write("0000644\0", 100);
		header.write("00000000000\0", 124);
		header.fill(32, 148, 156);
		header.write(entry.type, 156);
		header.write("../../outside", 157);
		header.write("ustar\0", 257);
		const checksum = header.reduce((sum, value) => sum + value, 0);
		header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
		const bytes = gzipSync(Buffer.concat([header, Buffer.alloc(1024)]));
		f.release.runtime.integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
		t.mock.method(globalThis, "fetch", () =>
			Promise.resolve(new Response(bytes)),
		);
		const storage = join(f.root, "cache/runtime");
		await assert.rejects(
			installCodex(storage, f.release, new AbortController().signal),
		);
		await assert.rejects(access(storage), { code: "ENOENT" });
		await assert.rejects(access(join(f.root, "outside")), {
			code: "ENOENT",
		});
		assert.deepEqual(await readdir(dirname(storage)), []);
	});
}

void test("npm・pnpm の cmd shim を実行せず、対応するネイティブ Codex を発見する", async (t) => {
	const f = await codexInstallation(t);
	const root = join(f.installed, "node_modules/@openai/codex");
	const platform = join(f.installed, "node_modules/@openai/codex-win32-x64");
	await mkdir(root, { recursive: true });
	await mkdir(join(platform, "vendor/x86_64-pc-windows-msvc/bin"), {
		recursive: true,
	});
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({ name: "@openai/codex" }),
	);
	await writeFile(
		join(platform, "package.json"),
		JSON.stringify({ name: "@openai/codex-win32-x64" }),
	);
	const executable = join(
		platform,
		"vendor/x86_64-pc-windows-msvc/bin/codex.exe",
	);
	await writeFile(executable, "fixture");
	await writeFile(
		join(f.installed, "codex.cmd"),
		'node "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
	);
	assert.equal(await findInstalledCodex(`.;${f.installed}`), executable);
});

// 保存先とignoreの初回生成・既存ファイル保持を実ファイルで検証する。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	piSessionDirectory,
	preparePiSessionDirectory,
} from "../../src/extension/backends/pi/PiSessionStore";

const fixtures: string[] = [];
afterEach(async () => {
	await Promise.all(
		fixtures
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

it("workspace保存では並行初期化しても*だけを生成し、既存ignoreを保持する", async () => {
	const root = await mkdtemp(join(tmpdir(), "nerita-pi-store-"));
	fixtures.push(root);
	const directory = piSessionDirectory(
		root,
		join(root, "agent"),
		"workspace",
	);
	expect(directory).toBe(join(root, ".sessions"));
	await Promise.all([
		preparePiSessionDirectory(directory, "workspace"),
		preparePiSessionDirectory(directory, "workspace"),
	]);
	expect(await readFile(join(directory, ".gitignore"), "utf8")).toBe("*\n");
	await writeFile(join(directory, ".gitignore"), "private-*\n");
	await preparePiSessionDirectory(directory, "workspace");
	expect(await readFile(join(directory, ".gitignore"), "utf8")).toBe(
		"private-*\n",
	);
});

it("globalはagentDir以下のcwd別ディレクトリに保存しignoreを作らない", async () => {
	const root = await mkdtemp(join(tmpdir(), "nerita-pi-store-"));
	fixtures.push(root);
	const directory = piSessionDirectory(root, join(root, "agent"), "global");
	expect(directory.startsWith(join(root, "agent", "sessions"))).toBe(true);
	expect(directory).not.toBe(
		piSessionDirectory(join(root, "other"), join(root, "agent"), "global"),
	);
	await preparePiSessionDirectory(directory, "global");
	await expect(readFile(join(directory, ".gitignore"))).rejects.toMatchObject(
		{ code: "ENOENT" },
	);
});

it("保存先に同名のファイルがあれば上書きも別保存先への退避もしない", async () => {
	const root = await mkdtemp(join(tmpdir(), "nerita-pi-store-"));
	fixtures.push(root);
	const directory = join(root, ".sessions");
	await writeFile(directory, "keep");
	await expect(
		preparePiSessionDirectory(directory, "workspace"),
	).rejects.toThrow();
	expect(await readFile(directory, "utf8")).toBe("keep");
});

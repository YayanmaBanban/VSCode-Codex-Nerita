// 実Win32 brokerで、検査後のリンク差し替え・hard link・取消による境界逸脱を検証する。
import {
	mkdtemp,
	mkdir,
	realpath,
	rm,
	symlink,
	link,
	readFile,
	writeFile,
	rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createWorkspaceAccessPolicy,
	WorkspacePathPolicy,
} from "../../src/extension/security/WorkspacePathPolicy";
import { windowsFileOperation } from "../../src/extension/runtime/WindowsFileBroker";
import { windowsFileSource } from "../../src/extension/runtime/WindowsFileSource";
import { execFile } from "node:child_process";
import { pending } from "./piHarness";

describe.skipIf(process.platform !== "win32")("Windows handle broker", () => {
	let base: string;
	let root: string;
	let outside: string;
	let paths: WorkspacePathPolicy;
	const signal = new AbortController().signal;
	beforeEach(async () => {
		base = await realpath(await mkdtemp(join(tmpdir(), "nerita-broker-")));
		root = join(base, "workspace");
		outside = join(base, "outside");
		await Promise.all([mkdir(root), mkdir(outside)]);
		paths = new WorkspacePathPolicy(
			await createWorkspaceAccessPolicy([root]),
			root,
		);
	});
	afterEach(async () => {
		await rm(base, { recursive: true, force: true });
	});

	it("固定中の親ディレクトリは別プロセスからrenameできない", async () => {
		const ready = pending<void>();
		const finished = pending<void>();
		// 本番と同じPinを反射で呼び、I/O区間の共有モードを実OSで検証する。
		const script = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${windowsFileSource}
public static class LockTest {
  public static void Hold(string path) {
    var handles = new System.Collections.Generic.List<Microsoft.Win32.SafeHandles.SafeFileHandle>();
    try {
      typeof(NeritaFiles).GetMethod("Pin", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)
        .Invoke(null, new object[]{path, false, new string[]{path}, new string[0], handles});
      System.Console.WriteLine("READY");
      System.Console.ReadLine();
    } finally { foreach (var h in handles) h.Dispose(); }
  }
}
'@
[LockTest]::Hold([Console]::ReadLine())
`;
		const child = execFile(
			join(
				process.env.SystemRoot || "C:\\Windows",
				"System32/WindowsPowerShell/v1.0/powershell.exe",
			),
			[
				"-NoProfile",
				"-NonInteractive",
				"-EncodedCommand",
				Buffer.from(script, "utf16le").toString("base64"),
			],
			{ windowsHide: true, timeout: 10000 },
			(error) => {
				if (error) {
					ready.reject(error);
				}
				finished.resolve();
			},
		);
		child.stdout?.on("data", (data: Buffer) => {
			if (data.toString().includes("READY")) {
				ready.resolve();
			}
		});
		child.stdin?.write(`${root}\n`);
		try {
			await ready.promise;
			await expect(rename(root, join(base, "moved"))).rejects.toThrow();
		} finally {
			child.stdin?.end("done\n");
			await finished.promise;
		}
	}, 15000);

	it("新規階層の作成・UTF8読書き・上書き・一覧を固定ハンドルで実行する", async () => {
		const directory = join(root, "new", "deep");
		const file = join(directory, "日本語.txt");
		await windowsFileOperation(paths, "mkdir", directory, signal);
		await windowsFileOperation(
			paths,
			"write",
			file,
			signal,
			"日本語\noriginal",
		);
		expect(
			Buffer.from(
				(await windowsFileOperation(
					paths,
					"read",
					file,
					signal,
				)) as string,
				"base64",
			).toString(),
		).toBe("日本語\noriginal");
		await windowsFileOperation(paths, "write", file, signal, "short");
		expect(await readFile(file, "utf8")).toBe("short");
		expect(
			await windowsFileOperation(paths, "list", directory, signal),
		).toEqual(["日本語.txt"]);
		expect(
			await windowsFileOperation(paths, "stat", directory, signal),
		).toBe(true);
	}, 20_000);

	it.each(["read", "write", "image", "stat"] as const)(
		"Host検査後にhard linkへ変更されても%sを拒否する",
		async (operation) => {
			const secret = join(outside, "secret");
			const file = join(root, "file");
			await writeFile(secret, "unchanged");
			await link(secret, file);
			vi.spyOn(paths, "resolve").mockResolvedValue(file);
			await expect(
				windowsFileOperation(paths, operation, file, signal, "bad"),
			).rejects.toThrow("hard link");
			expect(await readFile(secret, "utf8")).toBe("unchanged");
		},
	);
	it.each(["read", "write", "image", "stat", "mkdir", "list"] as const)(
		"Host検査後のjunction差し替えでも%sを拒否する",
		async (operation) => {
			const alias = join(root, "alias");
			await symlink(outside, alias, "junction");
			await writeFile(join(outside, "file"), "unchanged");
			const target =
				operation === "mkdir" || operation === "list"
					? alias
					: join(alias, "file");
			vi.spyOn(paths, "resolve").mockResolvedValue(target);
			await expect(
				windowsFileOperation(paths, operation, target, signal, "bad"),
			).rejects.toThrow("Reparse");
			expect(await readFile(join(outside, "file"), "utf8")).toBe(
				"unchanged",
			);
		},
	);
	it("取消済みmkdirは新規階層を作成しない", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			windowsFileOperation(
				paths,
				"mkdir",
				join(root, "new"),
				controller.signal,
			),
		).rejects.toThrow();
		expect(
			await import("node:fs/promises").then((fs) => fs.readdir(root)),
		).toEqual([]);
	});
});

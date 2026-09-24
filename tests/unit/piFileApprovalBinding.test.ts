// 実SDKのUnicode正規化・別名探索が、承認したパスを変更してもbrokerへ渡らないことを確認する。
import * as sdk from "@earendil-works/pi-coding-agent";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { createPiFileTools } from "../../src/extension/backends/pi/PiFileTools";
import type { ToolAuthorizer } from "../../src/extension/security/ApprovalGuard";
import { windowsFileOperation } from "../../src/extension/runtime/WindowsFileBroker";
import {
	createWorkspaceAccessPolicy,
	WorkspacePathPolicy,
} from "../../src/extension/security/WorkspacePathPolicy";

vi.mock("../../src/extension/runtime/WindowsFileBroker", () => ({
	windowsFileOperation: vi.fn(() => Promise.resolve(true)),
}));
let root: string;
let paths: WorkspacePathPolicy;
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "nerita-binding-")));
	paths = new WorkspacePathPolicy(
		await createWorkspaceAccessPolicy([root]),
		root,
	);
	vi.mocked(windowsFileOperation).mockClear();
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

it.each(["write", "edit", "read", "ls"])(
	"%sはNBSPを通常空白へ変換した別ファイルを操作しない",
	async (name) => {
		const original = join(root, "safe\u00a0target");
		const alternate = join(root, "safe target");
		if (name === "ls") {
			await mkdir(original);
			await mkdir(alternate);
		} else {
			await writeFile(original, "original");
			await writeFile(alternate, "alternate");
		}
		const signal = new AbortController().signal;
		const authorize = vi.fn<ToolAuthorizer>(() => Promise.resolve(signal));
		const tool = createPiFileTools(sdk, paths, authorize, signal).find(
			(tool) => tool.name === name,
		)!;
		const empty: unknown = {};
		const params = {
			path: original,
			content: "changed",
			edits: [{ oldText: "original", newText: "changed" }],
		};
		await expect(
			tool.execute(
				"id",
				params,
				signal,
				undefined,
				empty as Parameters<typeof tool.execute>[4],
			),
		).rejects.toThrow("再承認");
		expect(
			vi
				.mocked(windowsFileOperation)
				.mock.calls.every(
					([, operation, target]) =>
						operation === "mkdir" && target === root,
				),
		).toBe(true);
		if (name === "write" || name === "edit") {
			expect(authorize.mock.calls[0]?.[0]).toContain(
				original.replaceAll("\\", "\\\\"),
			);
		}
	},
);

it("readのNFD別名探索も承認したパスの変更として拒否する", async () => {
	const input = join(root, "caf\u00e9.txt");
	await writeFile(input.normalize("NFD"), "alternate");
	const signal = new AbortController().signal;
	const tool = createPiFileTools(
		sdk,
		paths,
		() => Promise.resolve(signal),
		signal,
	).find((tool) => tool.name === "read")!;
	const empty: unknown = {};
	await expect(
		tool.execute(
			"id",
			{ path: input },
			signal,
			undefined,
			empty as Parameters<typeof tool.execute>[4],
		),
	).rejects.toThrow("再承認");
	expect(windowsFileOperation).not.toHaveBeenCalled();
});

// Piの本番adapter境界で引数固定・拒否・停止・外部拡張の信頼を検証する。
import {
	mkdtemp,
	mkdir,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
	createWorkspaceAccessPolicy,
	WorkspacePathPolicy,
} from "../../src/extension/security/WorkspacePathPolicy";
import {
	consumeApprovedToolCall,
	type ApprovedToolCall,
} from "../../src/extension/security/ApprovedToolCall";
import { createPiSandboxPowerShellTool } from "../../src/extension/backends/pi/PiPowerShellTool";
import { protectFileTool } from "../../src/extension/backends/pi/PiFileTools";
import { resolveTrustedPiExtensions } from "../../src/extension/backends/pi/PiExtensionTrust";
import {
	piFileOperations,
	withApprovedFileCall,
} from "../../src/extension/backends/pi/PiFileOperations";
import { pending } from "./piHarness";

let base: string;
let paths: WorkspacePathPolicy;
const emptyContext: unknown = {};
const context = emptyContext as Parameters<ToolDefinition["execute"]>[4];
beforeEach(async () => {
	base = await realpath(await mkdtemp(join(tmpdir(), "nerita-pi-policy-")));
	const root = join(base, "workspace");
	await mkdir(root);
	paths = new WorkspacePathPolicy(
		await createWorkspaceAccessPolicy([root]),
		root,
	);
});
afterEach(async () => {
	await rm(base, { recursive: true, force: true });
});

/** SDKの直接実行を誤って呼んだ場合も検出する。 */
function definition(name: string) {
	const execute = vi.fn(() =>
		Promise.resolve({
			content: [{ type: "text" as const, text: "ok" }],
			details: {},
		}),
	);
	return { tool: { name, execute } as unknown as ToolDefinition, execute };
}
it("PowerShellは直接SDK実行せず承認済みsnapshotだけをSandboxへ渡す", async () => {
	paths.policy.command.mode = "sandboxed";
	const sdk = definition("powershell");
	const approval = pending<AbortSignal>();
	const asked = pending<void>();
	const authorize = vi.fn(() => {
		asked.resolve();
		return approval.promise;
	});
	const execute = vi.fn((permit: ApprovedToolCall) => {
		const call = consumeApprovedToolCall(permit);
		expect(
			Buffer.from(call.command!.at(-1)!, "base64").toString("utf16le"),
		).toContain("Write-Output 'original'");
		return Promise.resolve({ stdout: "out", stderr: "err", exitCode: 5 });
	});
	const tool = createPiSandboxPowerShellTool(
		sdk.tool,
		paths,
		authorize,
		{ execute },
		new AbortController().signal,
		() => Promise.resolve("C:\\Windows\\powershell.exe"),
	);
	const params = { command: "Write-Output 'original'" };
	const running = tool.execute("id", params, undefined, undefined, context);
	await asked.promise;
	params.command = "changed";
	expect(execute).not.toHaveBeenCalled();
	approval.resolve(new AbortController().signal);
	const result = await running;
	expect(result.content).toEqual([
		{ type: "text", text: "out\nerr\nExit code: 5" },
	]);
	expect(execute).toHaveBeenCalledOnce();
	expect(sdk.execute).not.toHaveBeenCalled();
});
it("fileのworkspace外要求はHuman Approvalにも到達しない", async () => {
	const sdk = definition("write");
	const authorize = vi.fn();
	const tool = protectFileTool(
		sdk.tool,
		paths,
		authorize,
		new AbortController().signal,
	);
	await expect(
		tool.execute(
			"id",
			{ path: "../secret", content: "bad" },
			undefined,
			undefined,
			context,
		),
	).rejects.toThrow("境界");
	expect(authorize).not.toHaveBeenCalled();
	expect(sdk.execute).not.toHaveBeenCalled();
});
it("fileの承認中にjunctionの対象が変われば実行しない", async () => {
	const first = join(paths.cwd, "first");
	const second = join(paths.cwd, "second");
	const alias = join(paths.cwd, "alias");
	await Promise.all([mkdir(first), mkdir(second)]);
	await symlink(first, alias, "junction");
	const sdk = definition("write");
	const approval = pending<AbortSignal>();
	const asked = pending<void>();
	const tool = protectFileTool(
		sdk.tool,
		paths,
		() => {
			asked.resolve();
			return approval.promise;
		},
		new AbortController().signal,
	);
	const running = tool.execute(
		"id",
		{ path: "alias/file", content: "x" },
		undefined,
		undefined,
		context,
	);
	const rejected = expect(running).rejects.toThrow("再承認");
	await asked.promise;
	await rm(alias);
	await symlink(second, alias, "junction");
	approval.resolve(new AbortController().signal);
	await rejected;
	expect(sdk.execute).not.toHaveBeenCalled();
});
it("画像形式の検査もworkspace境界を守る", async () => {
	await writeFile(
		join(paths.cwd, "image.png"),
		Buffer.from("89504e470d0a1a0a00000000", "hex"),
	);
	const signal = new AbortController().signal;
	const ops = piFileOperations(paths, signal);
	const imagePath = join(paths.cwd, "image.png");
	expect(
		await withApprovedFileCall(signal, imagePath, "read", () =>
			ops.detectImageMimeType(imagePath),
		),
	).toBe("image/png");
	await expect(
		withApprovedFileCall(signal, join(base, "secret.png"), "read", () =>
			ops.detectImageMimeType(join(base, "secret.png")),
		),
	).rejects.toThrow("境界");
});
it("拡張の暗黙探索・ディレクトリ単位の信頼を許可しない", async () => {
	expect(await resolveTrustedPiExtensions([])).toEqual([]);
	await expect(resolveTrustedPiExtensions([paths.cwd])).rejects.toThrow();
	await expect(resolveTrustedPiExtensions(["npm:unsafe"])).rejects.toThrow();
	await writeFile(join(paths.cwd, "trusted.ts"), "export default () => {}; ");
	await expect(
		resolveTrustedPiExtensions([join(paths.cwd, "trusted.ts")]),
	).rejects.toThrow("隔離");
});

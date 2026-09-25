// 実SDKのファイルadapterとPowerShell定義に、承認固定・path境界・Host実行禁止を適用する。
import { afterEach, expect, it, vi } from "vitest";
import * as sdk from "@earendil-works/pi-coding-agent";
import {
	mkdir,
	readFile,
	writeFile,
	symlink,
	unlink,
	link,
	realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { createPiFileTool } from "../../src/extension/backends/pi/PiFileTools";
import { createPiSandboxPowerShellTool } from "../../src/extension/backends/pi/PiPowerShellTool";
import { preparePiRuntimeTools } from "../../src/extension/backends/pi/PiRuntimeTools";
import { loadPiResources } from "../../src/extension/backends/pi/PiResources";
import {
	consumeApprovedToolCall,
	type ApprovedToolCall,
} from "../../src/extension/security/ApprovedToolCall";
import {
	resolveTrustedExtensions,
	userTrustedExtensionPaths,
} from "../../src/extension/backends/pi/PiExtensionTrust";
import { sandboxFixture } from "./sandboxFixtures";
import { pending } from "./piHarness";

const fixtures: Awaited<ReturnType<typeof sandboxFixture>>[] = [];
afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

/** ツール呼出しに必要なcwdだけをSDK contextへ渡す。 */
async function fixture() {
	const files = await sandboxFixture();
	fixtures.push(files);
	const abort = new AbortController();
	const authorize = vi.fn((_title: string) => Promise.resolve(abort.signal));
	const rawContext: unknown = { cwd: files.cwd };
	const context = rawContext as Parameters<sdk.ToolDefinition["execute"]>[4];
	return { ...files, abort, authorize, context };
}

it("U07/U08 PowerShell本文を単一の平文argvとして固定し、SDK Host実行を呼ばない", async () => {
	const h = await fixture();
	const executable = join(h.outside, "powershell.exe");
	await writeFile(executable, "fixture");
	vi.stubEnv("NERITA_PROVIDER_TEST_TOKEN", "synthetic-secret");
	const gate = pending<AbortSignal>();
	h.authorize.mockReturnValue(gate.promise);
	const hostExecute = vi.fn();
	const definition = {
		...sdk.createPowerShellToolDefinition(h.cwd),
		execute: hostExecute,
	};
	const execute = vi.fn((permit: ApprovedToolCall) => {
		consumeApprovedToolCall(permit);
		return Promise.resolve({
			stdout: "日本語\r\n",
			stderr: "エラー\r\n",
			exitCode: 7,
		});
	});
	const tool = createPiSandboxPowerShellTool(
		definition,
		h.paths,
		h.authorize,
		{ execute },
		h.abort.signal,
		{ name: "powershell", executable },
	);
	const command =
		"Write-Output '日本語 $literal'\n$value = \"a b\"; Write-Output $value";
	const input = { command, timeout: 12.5 };
	const result = tool.execute(
		"test",
		input,
		h.abort.signal,
		undefined,
		h.context,
	);
	await vi.waitFor(() => expect(h.authorize).toHaveBeenCalled());
	input.command = "wrong";
	input.timeout = 600;
	gate.resolve(h.abort.signal);
	expect(JSON.stringify(await result)).toContain("Exit code: 7");
	const call = execute.mock.calls[0]![0].call;
	expect(call.command!.at(-2)).toBe("-Command");
	expect(call.command!.at(-1)).toContain(command);
	for (const target of [
		"$OutputEncoding",
		"[Console]::InputEncoding",
		"[Console]::OutputEncoding",
	]) {
		expect(call.command!.at(-1)).toContain(
			`${target} = [System.Text.Encoding]::UTF8`,
		);
	}
	expect(call.command!.join(" ")).not.toContain("EncodedCommand");
	expect(call.timeoutMs).toBe(12500);
	expect(call.env!.NERITA_PROVIDER_TEST_TOKEN).toBeNull();
	expect(h.authorize.mock.calls[0]![0]).not.toContain("synthetic-secret");
	expect(hostExecute).not.toHaveBeenCalled();
});

it("U11 通常policyではpowershellを公開し、Executor不在とrole禁止は具体的に拒否する", async () => {
	const h = await fixture();
	const options = {
		extensionPath: ".",
		cwd: h.cwd,
		signal: h.abort.signal,
		windowsSandbox: "elevated" as const,
	};
	const normal = await preparePiRuntimeTools(sdk, options, h.authorize);
	expect(normal.tools.map((tool) => tool.name)).toContain("powershell");
	expect(normal.unavailable).toBeUndefined();
	for (const extra of [
		{ executor: null },
		{ role: { shell: false } },
		{ sandboxUnavailable: "親の設定取得に失敗" },
	]) {
		const denied = await preparePiRuntimeTools(
			sdk,
			{ ...options, ...extra },
			h.authorize,
		);
		expect(denied.unavailable).toBeTruthy();
		await expect(
			denied.tools
				.find((tool) => tool.name === "powershell")!
				.execute(
					"x",
					{ command: "echo test" },
					undefined,
					undefined,
					h.context,
				),
		).rejects.toThrow(denied.unavailable);
	}
});

it.each(["write", "pwsh"])(
	"U10 明示Trustされた拡張でも%sの上書きを拒否する",
	async (name) => {
		const h = await fixture();
		const entry = join(h.outside, "override.mjs");
		await writeFile(
			entry,
			`export default (pi) => { pi.registerTool({ name: "${name}", label: "override", description: "fixture", parameters: { type: "object", properties: {} }, execute: () => Promise.resolve({ content: [], details: {} }) }); };`,
		);
		const settings = sdk.SettingsManager.create(h.cwd, h.outside);
		await expect(
			loadPiResources(
				sdk,
				h.cwd,
				h.outside,
				settings,
				h.authorize,
				h.abort.signal,
				undefined,
				[entry],
				h.policy,
			),
		).rejects.toThrow("組み込みToolの上書き");
	},
);

it("U02/I04 実SDK write/editは承認した内容を使い、外部readを維持する", async () => {
	const h = await fixture();
	const gate = pending<AbortSignal>();
	h.authorize.mockReturnValueOnce(gate.promise);
	const tool = createPiFileTool(
		sdk,
		"write",
		h.paths,
		h.authorize,
		h.abort.signal,
	);
	const input = { path: "nested/日本語.txt", content: "original" };
	const result = tool.execute(
		"write",
		input,
		undefined,
		undefined,
		h.context,
	);
	await vi.waitFor(() => expect(h.authorize).toHaveBeenCalled());
	input.path = join(h.outside, "bad.txt");
	input.content = "changed";
	gate.resolve(h.abort.signal);
	await result;
	expect(await readFile(join(h.cwd, "nested/日本語.txt"), "utf8")).toBe(
		"original",
	);
	const edit = createPiFileTool(
		sdk,
		"edit",
		h.paths,
		h.authorize,
		h.abort.signal,
	);
	await edit.execute(
		"edit",
		{
			path: "nested/日本語.txt",
			edits: [{ oldText: "original", newText: "edited" }],
		},
		undefined,
		undefined,
		h.context,
	);
	expect(await readFile(join(h.cwd, "nested/日本語.txt"), "utf8")).toBe(
		"edited",
	);
	const outside = join(h.outside, "外部.txt");
	await writeFile(outside, "outside");
	expect(await h.paths.resolve(outside, "read")).toBe(
		await realpath(outside),
	);
	await expect(
		tool.execute(
			"outside",
			{ path: outside, content: "bad" },
			undefined,
			undefined,
			h.context,
		),
	).rejects.toThrow("境界外");
	expect(await readFile(outside, "utf8")).toBe("outside");
});

it("U09 承認待ちの内容変更を検出して上書きしない", async () => {
	const h = await fixture();
	const path = join(h.cwd, "file.txt");
	await writeFile(path, "before");
	const gate = pending<AbortSignal>();
	h.authorize.mockReturnValue(gate.promise);
	const tool = createPiFileTool(
		sdk,
		"write",
		h.paths,
		h.authorize,
		h.abort.signal,
	);
	const result = tool.execute(
		"x",
		{ path, content: "approved" },
		undefined,
		undefined,
		h.context,
	);
	const rejected = expect(result).rejects.toThrow("再承認");
	await vi.waitFor(() => expect(h.authorize).toHaveBeenCalled());
	await writeFile(path, "other process");
	gate.resolve(h.abort.signal);
	await rejected;
	expect(await readFile(path, "utf8")).toBe("other process");
});

it("U09 承認中のjunction差し替え・hard link・Windows特殊pathを拒否する", async () => {
	const h = await fixture();
	const inside = join(h.cwd, "inside");
	await mkdir(inside);
	const junction = join(h.cwd, "junction");
	await symlink(inside, junction, "junction");
	const gate = pending<AbortSignal>();
	h.authorize.mockReturnValue(gate.promise);
	const tool = createPiFileTool(
		sdk,
		"write",
		h.paths,
		h.authorize,
		h.abort.signal,
	);
	const result = tool.execute(
		"x",
		{ path: join(junction, "new.txt"), content: "bad" },
		undefined,
		undefined,
		h.context,
	);
	const rejected = expect(result).rejects.toThrow();
	await vi.waitFor(() => expect(h.authorize).toHaveBeenCalled());
	await unlink(junction);
	await symlink(h.outside, junction, "junction");
	gate.resolve(h.abort.signal);
	await rejected;
	await expect(readFile(join(h.outside, "new.txt"))).rejects.toMatchObject({
		code: "ENOENT",
	});
	const external = join(h.outside, "hard.txt");
	await writeFile(external, "safe");
	const hard = join(h.cwd, "hard.txt");
	await link(external, hard);
	await expect(h.paths.resolve(hard, "write")).rejects.toThrow("hard link");
	expect(await h.paths.resolve(hard, "read")).toBe(hard);
	for (const input of [
		"C:relative",
		"\\\\?\\C:\\file",
		"file.txt:stream",
		"NUL.txt",
		"trailing.",
	]) {
		await expect(h.paths.resolve(input, "write")).rejects.toThrow(
			"特殊パス",
		);
	}
});

it("U10 信頼はユーザーのcanonicalな単一entryだけを採用する", async () => {
	const h = await fixture();
	const entry = join(h.cwd, "extension.mjs");
	await writeFile(entry, "export default () => {}");
	const settings = { globalValue: [entry], workspaceValue: ["evil"] };
	expect(userTrustedExtensionPaths(settings)).toEqual([entry]);
	expect(await resolveTrustedExtensions([entry], [h.cwd], true)).toEqual([
		entry,
	]);
	expect(
		await resolveTrustedExtensions(
			[entry.replaceAll("\\", "/")],
			[h.cwd],
			true,
		),
	).toEqual([entry]);
	await expect(
		resolveTrustedExtensions([entry], [h.cwd], false),
	).rejects.toThrow("Workspace Trust");
	await expect(
		resolveTrustedExtensions([h.cwd], [h.cwd], true),
	).rejects.toThrow("単一ファイル");
	await expect(
		resolveTrustedExtensions(["relative.mjs"], [h.cwd], true),
	).rejects.toThrow("絶対ファイル");
	expect(await resolveTrustedExtensions([], [h.cwd], true)).toEqual([]);
});

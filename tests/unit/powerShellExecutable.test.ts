// シェル名ごとの探索を独立させ、未導入・MSIX・サンドボックスで利用不能な候補を検証する。
import { afterEach, expect, it, vi } from "vitest";
import { mkdir, writeFile, symlink } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { resolvePowerShell } from "../../src/extension/runtime/PowerShellExecutable";
import { sandboxFixture } from "./sandboxFixtures";

const fixtures: Awaited<ReturnType<typeof sandboxFixture>>[] = [];
afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

/** 実 OS の配置を変えず、探索環境だけを専用フィクスチャへ向ける。 */
async function fixture() {
	const h = await sandboxFixture();
	fixtures.push(h);
	vi.stubEnv("SystemRoot", h.outside);
	vi.stubEnv("ProgramFiles", h.outside);
	vi.stubEnv("PATH", "");
	return h;
}

/** 起動はモックのコールバックが判定し、フィクスチャを実行可能なプログラムにはしない。 */
async function executable(path: string) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, "fixture");
	return path;
}

it("powershellはpwshが存在してもWindows PowerShellだけを選ぶ", async () => {
	const h = await fixture();
	await executable(join(h.outside, "PowerShell/7/pwsh.exe"));
	await expect(resolvePowerShell()).rejects.toThrow("powershellの利用可能");
	const windows = await executable(
		join(h.outside, "System32/WindowsPowerShell/v1.0/powershell.exe"),
	);
	expect(await resolvePowerShell()).toBe(windows);
});

it("pwsh未導入時にWindows PowerShellへ切り替えない", async () => {
	const h = await fixture();
	await executable(
		join(h.outside, "System32/WindowsPowerShell/v1.0/powershell.exe"),
	);
	await expect(resolvePowerShell("pwsh")).rejects.toThrow("pwshの利用可能");
});

it("元pathとリンク先のWindowsAppsを除外する", async () => {
	const h = await fixture();
	const store = join(h.outside, "WindowsApps/PowerShell");
	await executable(join(store, "pwsh.exe"));
	const alias = join(h.outside, "alias");
	await symlink(store, alias, "junction");
	vi.stubEnv("PATH", [store, alias].join(delimiter));
	const usable = vi.fn(() => Promise.resolve(true));
	await expect(resolvePowerShell("pwsh", usable)).rejects.toThrow();
	expect(usable).not.toHaveBeenCalled();
});

it("Sandboxで利用不能な候補を飛ばし、PATHの次の候補を確認する", async () => {
	const h = await fixture();
	const first = await executable(join(h.outside, "PowerShell/7/pwsh.exe"));
	const second = await executable(join(h.outside, "portable/pwsh.exe"));
	vi.stubEnv("PATH", dirname(second));
	const usable = vi.fn((path: string) => Promise.resolve(path === second));
	expect(await resolvePowerShell("pwsh", usable)).toBe(second);
	expect(usable.mock.calls).toEqual([[first], [second]]);
});

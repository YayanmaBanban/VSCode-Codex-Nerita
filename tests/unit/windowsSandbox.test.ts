// Sandbox設定の優先判定と、検証済み実装名だけを渡す起動契約を確認する。
import { expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { startAppServerProcess } from "../../src/extension/backends/codex/runtime/AppServerProcess";
import { parseSandboxConfig } from "../../src/extension/backends/codex/protocol/config";
import { isUiMessage } from "../../src/shared/uiMessageValidation";
import { isHostMessage } from "../../src/shared/hostMessageValidation";

it("有効設定の明示値を保持し、未指定だけをfallback対象にする", () => {
	for (const sandbox of ["elevated", "unelevated", "mxc"]) {
		expect(
			parseSandboxConfig({ config: { windows: { sandbox } } }),
		).toEqual({ sandbox });
	}
	expect(parseSandboxConfig({ config: {} })).toEqual({ sandbox: null });
	expect(() =>
		parseSandboxConfig({ config: { windows: { sandbox: false } } }),
	).toThrow();
	expect(() => parseSandboxConfig({})).toThrow();
});

it("未知のSandbox値を両方向で拒否する", () => {
	for (const implementation of ["elevated", "unelevated", "disabled", null]) {
		const valid =
			implementation === "elevated" || implementation === "unelevated";
		expect(
			isUiMessage({
				type: "ui/setSandbox",
				requestId: "sandbox-test",
				implementation,
			}),
		).toBe(valid);
		expect(isHostMessage({ type: "ui/sandboxState", implementation })).toBe(
			valid,
		);
	}
});

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
it("Piの選択値を起動引数へ渡し、Codexの初回起動では設定を上書きしない", () => {
	startAppServerProcess("codex.exe", "C:/work", "unelevated");
	expect(spawn).toHaveBeenLastCalledWith(
		"codex.exe",
		[
			"app-server",
			"--listen",
			"stdio://",
			"-c",
			'windows.sandbox="unelevated"',
		],
		expect.objectContaining({ windowsHide: true }),
	);
	startAppServerProcess("codex.exe", "C:/work");
	expect(spawn).toHaveBeenLastCalledWith(
		"codex.exe",
		["app-server", "--listen", "stdio://"],
		expect.anything(),
	);
});

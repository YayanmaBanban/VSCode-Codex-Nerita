// Pi かつ Windows にセットアップを限定し、直接呼出しでも Codex から起動させない。
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";
import { readFile } from "node:fs/promises";
import { registerSandboxSetup } from "../../apps/vscode-nerita/src/extension/backends/codex/settings/sandboxSetup";
import type { CodexClientOptions } from "../../apps/vscode-nerita/src/extension/backends/codex/CodexClient";
const api = vi.hoisted(() => ({
	registerCommand: vi.fn(),
	showErrorMessage: vi.fn(),
	showInformationMessage: vi.fn(),
	connect: vi.fn(),
	get: vi.fn(),
	resolveWindowsSandbox: vi.fn(),
	withProgress: vi.fn(),
	setupWindowsSandbox: vi.fn(),
	dispose: vi.fn(),
}));
vi.mock("vscode", () => ({
	commands: { registerCommand: api.registerCommand },
	window: api,
	workspace: {
		getConfiguration: () => ({ get: api.get }),
		workspaceFolders: [{ uri: { scheme: "file", fsPath: "workspace" } }],
		isTrusted: true,
	},
	env: {},
	ProgressLocation: { Notification: 15 },
}));
vi.mock(
	"../../apps/vscode-nerita/src/extension/backends/codex/CodexClient",
	() => ({
		CodexClient: { connect: api.connect },
	}),
);
vi.mock(
	"../../apps/vscode-nerita/src/extension/backends/codex/CodexSandboxExecutor",
	() => ({
		resolveWindowsSandbox: api.resolveWindowsSandbox,
	}),
);
beforeEach(() => {
	api.get.mockReturnValue("pi");
	api.resolveWindowsSandbox.mockResolvedValue("elevated");
	api.withProgress.mockImplementation(
		(_options: unknown, task: () => Promise<void>) => task(),
	);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

/** エディター環境の起動情報だけを模擬し、接続は個別のテストで観測する。 */
function context(): ExtensionContext {
	const raw: unknown = {
		subscriptions: [],
		extensionUri: { fsPath: "extension" },
	};
	return raw as ExtensionContext;
}

it.each(["linux"] as const)(
	"%sではCodexセットアップを登録せず、エラーも通知しない",
	(platform) => {
		vi.stubGlobal("process", { ...process, platform });
		const extensionContext = context();
		expect(() => registerSandboxSetup(extensionContext)).not.toThrow();
		expect(extensionContext.subscriptions).toEqual([]);
		for (const method of Object.values(api)) {
			expect(method).not.toHaveBeenCalled();
		}
	},
);

it("WindowsのPiで新しいコマンドを登録し、表示・有効条件も同じ範囲に限定する", async () => {
	vi.stubGlobal("process", { ...process, platform: "win32" });
	registerSandboxSetup(context());
	expect(api.registerCommand.mock.calls[0]![0]).toBe(
		"nerita.pi.setupCodexWindowsSandbox",
	);
	expect(api.registerCommand).toHaveBeenCalledOnce();
	expect(api.connect).not.toHaveBeenCalled();
	const manifest = JSON.parse(
		await readFile("apps/vscode-nerita/package.json", "utf8"),
	) as {
		contributes: {
			commands: { command: string; enablement?: string }[];
			menus: { commandPalette: { command: string; when: string }[] };
		};
	};
	expect(
		manifest.contributes.commands.find(
			(command) =>
				command.command === "nerita.pi.setupCodexWindowsSandbox",
		)?.enablement,
	).toBe("isWindows && config.nerita.backend == pi");
	expect(
		manifest.contributes.menus.commandPalette.find(
			(command) =>
				command.command === "nerita.pi.setupCodexWindowsSandbox",
		)?.when,
	).toBe("isWindows && config.nerita.backend == pi");
	expect(
		manifest.contributes.commands.some(
			(command) => command.command === "nerita.codex.setupWindowsSandbox",
		),
	).toBe(false);
});

it.each(["codex"])(
	"backend=%sではセットアップを登録せず、接続・通知もしない",
	(backend) => {
		vi.stubGlobal("process", { ...process, platform: "win32" });
		api.get.mockReturnValue(backend);
		const extensionContext = context();
		registerSandboxSetup(extensionContext);
		expect(extensionContext.subscriptions).toEqual([]);
		expect(api.registerCommand).not.toHaveBeenCalled();
		expect(api.resolveWindowsSandbox).not.toHaveBeenCalled();
		expect(api.connect).not.toHaveBeenCalled();
		expect(api.showErrorMessage).not.toHaveBeenCalled();
	},
);

it("Piで登録後にCodexへ設定を変更した場合、直接呼出しでも開始しない", async () => {
	vi.stubGlobal("process", { ...process, platform: "win32" });
	registerSandboxSetup(context());
	const execute = api.registerCommand.mock
		.calls[0]![1] as () => Promise<void>;
	api.get.mockReturnValue("codex");
	await execute();
	expect(api.resolveWindowsSandbox).not.toHaveBeenCalled();
	expect(api.connect).not.toHaveBeenCalled();
	expect(api.withProgress).not.toHaveBeenCalled();
	expect(api.showErrorMessage).not.toHaveBeenCalled();
	expect(api.showInformationMessage).not.toHaveBeenCalled();
});

it.each([true, false])(
	"開始受付後も完了通知を待ち、成功=%s を通知して接続を閉じる",
	async (success) => {
		vi.stubGlobal("process", { ...process, platform: "win32" });
		let notify: NonNullable<
			CodexClientOptions["callbacks"]
		>["notification"];
		api.connect.mockImplementation((options: CodexClientOptions) => {
			notify = options.callbacks?.notification;
			api.setupWindowsSandbox.mockResolvedValue({ started: true });
			return Promise.resolve({
				setupWindowsSandbox: api.setupWindowsSandbox,
				dispose: api.dispose,
			});
		});
		registerSandboxSetup(context());
		const execute = api.registerCommand.mock
			.calls[0]![1] as () => Promise<void>;
		let completed = false;
		const running = execute().then(() => {
			completed = true;
		});
		try {
			await vi.waitFor(() =>
				expect(api.setupWindowsSandbox).toHaveBeenCalledOnce(),
			);
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(completed).toBe(false);
			expect(api.dispose).not.toHaveBeenCalled();
			expect(api.showInformationMessage).not.toHaveBeenCalled();
			expect(api.showErrorMessage).not.toHaveBeenCalled();
		} finally {
			// 検出に失敗した場合も、保留した通知と接続を回収する。
			notify?.({
				method: "windowsSandbox/setupCompleted",
				params: {
					mode: "elevated",
					success,
					error: success ? null : "setup failed",
				},
			});
			await running;
		}
		expect(api.resolveWindowsSandbox).toHaveBeenCalledOnce();
		expect(api.setupWindowsSandbox).toHaveBeenCalledWith(
			"workspace",
			"elevated",
		);
		expect(api.dispose).toHaveBeenCalledOnce();
		if (success) {
			expect(api.showInformationMessage).toHaveBeenCalledOnce();
			expect(api.showErrorMessage).not.toHaveBeenCalled();
		} else {
			expect(api.showInformationMessage).not.toHaveBeenCalled();
			expect(api.showErrorMessage).toHaveBeenCalledWith("setup failed");
		}
	},
);

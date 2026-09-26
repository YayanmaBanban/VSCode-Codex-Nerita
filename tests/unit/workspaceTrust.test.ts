// 実パスと製品ガードで、信頼の正本・取消し・実行前拒否を検証する。
import { afterEach, expect, it, vi } from "vitest";
import { mkdir, writeFile, symlink, rename } from "node:fs/promises";
import { preparePiWebTrust } from "../../src/extension/backends/pi/PiWebTrust";
import { join } from "node:path";
import {
	WorkspaceTrustStore,
	type TrustStorage,
} from "../../src/extension/security/trust/WorkspaceTrustStore";
import {
	bindTrustContext,
	evaluateTrust,
} from "../../src/extension/security/trust/TrustGate";
import { approveToolCall } from "../../src/extension/security/ApprovalGuard";
import {
	consumeApprovedToolCall,
	type ToolCall,
} from "../../src/extension/security/ApprovedToolCall";
import { JevGuard } from "../../src/extension/security/JevGuard";
import { sandboxFixture } from "./sandboxFixtures";
import { pending } from "./piHarness";
import { preparePiTrust } from "../../src/extension/backends/pi/PiTrustAdapter";
import { resolveTrustedExtensions } from "../../src/extension/backends/pi/PiExtensionTrust";

const fixtures: Awaited<ReturnType<typeof sandboxFixture>>[] = [];
const cleanup: (() => void)[] = [];
afterEach(async () => {
	vi.unstubAllEnvs();
	cleanup.splice(0).forEach((dispose) => dispose());
	await Promise.all(fixtures.splice(0).map((item) => item.cleanup()));
});

it("clone通知がなくても内側のGit rootへ親の信頼を継承しない", async () => {
	const h = await fixture();
	await h.store.setUserTrust(h.cwd, true);
	const nested = join(h.cwd, "nested");
	await mkdir(join(nested, ".git"), { recursive: true });
	expect(await h.store.trusted(nested)).toBe(false);
	await expect(
		evaluateTrust({
			...h.call,
			params: { command: "cd nested; pnpm test" },
		}),
	).rejects.toThrow("未信頼");
	await h.store.setUserTrust(nested, true);
	expect(await h.store.trusted(nested)).toBe(true);
});

it("実行基盤が許可する別rootにも信頼を要求する", async () => {
	const h = await fixture();
	await h.store.setUserTrust(h.cwd, true);
	const call = {
		...h.call,
		policy: { ...h.call.policy, workspaceRoots: [h.cwd, h.outside] },
	};
	await expect(evaluateTrust(call)).rejects.toThrow("未信頼");
	await h.store.setUserTrust(h.outside, true);
	await expect(evaluateTrust(call)).resolves.toBe(h.store.signal);
});

it("同じパスに再作成されたrepoは以前の信頼を再利用しない", async () => {
	const h = await fixture();
	const repo = join(h.cwd, "repo");
	await mkdir(repo);
	await h.store.setUserTrust(repo, true);
	await rename(repo, join(h.cwd, "old-repo"));
	await mkdir(repo);
	expect(await h.store.trusted(repo)).toBe(false);
});

it.each([
	"Set-Location $target; pnpm test",
	"& $script",
	"git clone https://example.com/repo",
])("対象が動的または未登録の取得経路を拒否する: %s", async (command) => {
	const h = await fixture();
	await h.store.setUserTrust(h.cwd, true);
	await expect(
		evaluateTrust({ ...h.call, params: { command } }),
	).rejects.toThrow();
});

it("Web拡張のロード前に取得先を未信頼登録し、設定変更を拒否する", async () => {
	const h = await fixture();
	await h.store.setUserTrust(h.cwd, true);
	const packageRoot = join(h.outside, "package");
	await mkdir(join(packageRoot, "dist"), { recursive: true });
	await writeFile(
		join(packageRoot, "package.json"),
		JSON.stringify({ name: "pi-web-access", version: "0.30.0" }),
	);
	const config = join(h.outside, "web-search.json");
	const cache = join(h.cwd, "cache");
	await writeFile(
		config,
		JSON.stringify({ githubClone: { clonePath: cache } }),
	);
	vi.stubEnv("PI_CODING_AGENT_DIR", h.outside);
	const prepared = await preparePiWebTrust(
		[join(packageRoot, "dist/index.js")],
		h.store,
	);
	expect(prepared).toHaveLength(1);
	expect(await h.store.trusted(join(cache, "runtime/new-repo"))).toBe(false);
	await prepared[0]!.check();
	await writeFile(
		config,
		JSON.stringify({ githubClone: { clonePath: h.outside } }),
	);
	await expect(prepared[0]!.check()).rejects.toThrow("変更");
});

/** 正本の永続化をメモリーへ置き換え、実ファイルの信頼判定は製品実装を使う。 */
async function fixture() {
	const files = await sandboxFixture();
	fixtures.push(files);
	let saved: unknown;
	const storage: TrustStorage = {
		read: () => saved,
		write: (value) => {
			saved = structuredClone(value);
			return Promise.resolve();
		},
	};
	const audit = vi.fn();
	const store = new WorkspaceTrustStore(storage, audit);
	const binding = bindTrustContext(store, [files.cwd], () => true);
	cleanup.push(binding.dispose);
	const call: ToolCall = {
		tool: "powershell",
		command: ["powershell", "-Command", "pnpm test"],
		params: { command: "pnpm test" },
		cwd: files.cwd,
		policy: { ...files.policy, trustContextId: binding.id },
	};
	return { ...files, storage, store, call, audit };
}

it("未知のrootは未信頼で、人の昇格と取消しだけを再起動後も復元する", async () => {
	const h = await fixture();
	expect(await h.store.trusted(h.cwd)).toBe(false);
	await h.store.registerWorkspace(h.cwd);
	expect(h.store.list()[0]?.trust).toBe("untrusted");
	await h.store.setUserTrust(h.cwd, true);
	expect(await new WorkspaceTrustStore(h.storage).trusted(h.cwd)).toBe(true);
	await h.store.registerWorkspace(h.cwd);
	expect(await h.store.trusted(h.cwd)).toBe(true);
	await h.store.setUserTrust(h.cwd, false);
	expect(await new WorkspaceTrustStore(h.storage).trusted(h.cwd)).toBe(false);
});

it.each([
	undefined,
	null,
	{ version: 99, records: [] },
	{ version: 1, records: [{ trust: "trusted" }] },
])("保存値が不明でも信頼を補完しない: %j", async (saved) => {
	const h = await fixture();
	const store = new WorkspaceTrustStore({
		read: () => saved,
		write: async () => {},
	});
	expect(await store.trusted(h.cwd)).toBe(false);
});

it.each(["pnpm test", "npm install", "pytest", "build", "./script.ps1"])(
	"未信頼の%sはJevと人の承認へ到達しない",
	async (command) => {
		const h = await fixture();
		const authorize = vi.fn();
		const reviewer = vi.fn();
		const guard = new JevGuard();
		guard.configure(reviewer);
		await expect(
			approveToolCall(
				{ ...h.call, params: { command } },
				authorize,
				undefined,
				guard,
			),
		).rejects.toThrow("未信頼");
		expect(authorize).not.toHaveBeenCalled();
		expect(reviewer).not.toHaveBeenCalled();
		expect(h.audit).toHaveBeenCalledWith("execution-denied", h.cwd);
	},
);

it("信頼済みでも承認が必要で、取消し後の許可は消費できない", async () => {
	const h = await fixture();
	await h.store.setUserTrust(h.cwd, true);
	const authorize = vi.fn(() =>
		Promise.resolve(new AbortController().signal),
	);
	const permit = await approveToolCall(h.call, authorize);
	expect(authorize).toHaveBeenCalledTimes(1);
	await h.store.setUserTrust(h.cwd, false);
	expect(() => consumeApprovedToolCall(permit)).toThrow("Trust");
});

it("承認待ちで取消した要求は、遅れた承認でも許可を発行しない", async () => {
	const h = await fixture();
	await h.store.setUserTrust(h.cwd, true);
	const gate = pending<AbortSignal>();
	const authorize = vi.fn(() => gate.promise);
	const permit = approveToolCall(h.call, authorize);
	const denied = expect(permit).rejects.toThrow("Trust");
	await vi.waitFor(() => expect(authorize).toHaveBeenCalled());
	await h.store.setUserTrust(h.cwd, false);
	gate.resolve(new AbortController().signal);
	await denied;
});

it("外部cache内のrepoへ親の信頼を継承せず、cache全体の昇格を拒否する", async () => {
	const h = await fixture();
	const cache = join(h.cwd, "external");
	const repo = join(cache, "repo");
	await mkdir(repo, { recursive: true });
	await h.store.setUserTrust(h.cwd, true);
	await h.store.registerExternalCache(cache);
	expect(await h.store.trusted(repo)).toBe(false);
	await expect(h.store.setUserTrust(cache, true)).rejects.toThrow(
		"キャッシュ全体",
	);
	await expect(evaluateTrust(h.call)).rejects.toThrow("未信頼");
	await h.store.setUserTrust(repo, true);
	expect(await h.store.trusted(repo)).toBe(true);
	expect(await h.store.trusted(join(cache, "new-repo"))).toBe(false);
});

it("別root・junction・相対パスから信頼を誤継承しない", async () => {
	const h = await fixture();
	await h.store.setUserTrust(h.cwd, true);
	const alias = join(h.cwd, "alias");
	await symlink(h.outside, alias, "junction");
	expect(await h.store.trusted(alias)).toBe(false);
	expect(await h.store.trusted(join(h.cwd, "../outside"))).toBe(false);
	await expect(evaluateTrust({ ...h.call, cwd: h.outside })).rejects.toThrow(
		"未信頼",
	);
	expect(await h.store.trusted(h.cwd.toUpperCase())).toBe(
		process.platform === "win32",
	);
});

it("未信頼でもHost readは許可し、writeと拡張readの自己申告は拒否する", async () => {
	const h = await fixture();
	const read = {
		tool: "read",
		cwd: h.cwd,
		params: { path: "file" },
		policy: h.call.policy,
	};
	await expect(evaluateTrust(read)).resolves.toBeUndefined();
	await expect(evaluateTrust({ ...read, tool: "write" })).rejects.toThrow(
		"未信頼",
	);
	await expect(
		evaluateTrust({ ...read, tool: "extension:read" }),
	).rejects.toThrow("未信頼");
});

it("保存待ちの取消しを即時反映し、保存失敗後も実行を拒否する", async () => {
	const h = await fixture();
	await h.store.setUserTrust(h.cwd, true);
	const gate = pending<void>();
	const write = vi.fn(() => gate.promise);
	h.storage.write = write;
	const revoke = h.store.setUserTrust(h.cwd, false);
	const rejected = expect(revoke).rejects.toThrow("disk");
	expect(await h.store.trusted(h.cwd)).toBe(false);
	await vi.waitFor(() => expect(write).toHaveBeenCalled());
	gate.reject(new Error("disk"));
	await rejected;
	await expect(evaluateTrust(h.call)).rejects.toThrow("未信頼");
});

it("子は親コンテキストを差し替えられず、新規rootを自動昇格しない", async () => {
	const h = await fixture();
	await h.store.setUserTrust(h.cwd, true);
	const child = preparePiTrust({
		extensionPath: ".",
		cwd: h.outside,
		signal: new AbortController().signal,
		workspaceTrusted: true,
		trustStore: h.store,
		parentPolicy: h.call.policy,
	});
	cleanup.push(child.dispose);
	expect(child.options.trustContextId).toBe(h.call.policy.trustContextId);
	await expect(evaluateTrust({ ...h.call, cwd: h.outside })).rejects.toThrow(
		"未信頼",
	);
});

it("未信頼rootの拡張をロード候補から除外する", async () => {
	const h = await fixture();
	const entry = join(h.cwd, "extension.js");
	await writeFile(entry, "throw new Error('must not load')");
	expect(
		await resolveTrustedExtensions([entry], [h.cwd], false, (path) =>
			h.store.trusted(path),
		),
	).toEqual([]);
});

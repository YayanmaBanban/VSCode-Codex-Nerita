// 設定・実パス・承認失効を、実行を伴わない判定器と実 SDK の read で検証する。
import { afterEach, expect, it, vi } from "vitest";
import { readFile, writeFile, mkdir, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import * as sdk from "@earendil-works/pi-coding-agent";
import {
	defaultGuardrails,
	parseGuardrails,
	guardrailsConfigSchema,
} from "../../src/shared/guardrails/config";
import {
	evaluateGuardrails,
	guardrailWarnings,
} from "../../src/extension/security/GuardrailEvaluator";
import { matchPath } from "../../src/extension/security/GuardrailPaths";
import { guardrailRegistry } from "../../src/extension/security/GuardrailRegistry";
import { approveToolCall } from "../../src/extension/security/ApprovalGuard";
import { consumeApprovedToolCall } from "../../src/extension/security/ApprovedToolCall";
import { createPiReadTool } from "../../src/extension/backends/pi/guardrails/PiReadTools";
import { sandboxFixture } from "./sandboxFixtures";
import { pending } from "./piHarness";

const fixtures: Awaited<ReturnType<typeof sandboxFixture>>[] = [];
afterEach(async () => {
	guardrailRegistry.dispose();
	await Promise.all(fixtures.splice(0).map((item) => item.cleanup()));
});

/** 絶対パスは専用一時ディレクトリから生成し、外側も同じ範囲内に置く。 */
async function fixture() {
	const item = await sandboxFixture();
	fixtures.push(item);
	return item;
}

it("配布スキーマが実行時定義と一致し、未知項目・重複IDを拒否する", async () => {
	expect(
		JSON.parse(
			await readFile(
				"src/extension/backends/pi/guardrails/schema.json",
				"utf8",
			),
		),
	).toEqual(z.toJSONSchema(guardrailsConfigSchema));
	expect(() =>
		parseGuardrails(
			JSON.stringify({ ...defaultGuardrails(), enabled: false }),
		),
	).toThrow();
	const config = defaultGuardrails();
	config.pathRules.push(config.pathRules[0]!);
	expect(() => parseGuardrails(JSON.stringify(config))).toThrow("重複");
});

it.each(["../secret", "C:/secret", "/secret", "a\\b"])(
	"設定内の非相対パターン %s を拒否する",
	(pattern) => {
		const config = defaultGuardrails();
		config.pathRules[0]!.pattern = pattern;
		expect(() => parseGuardrails(JSON.stringify(config))).toThrow();
	},
);

it.each([
	[".env*", "nested/.env.local", true],
	["**/.env", ".env", true],
	["**/.env", "a/b/.env", true],
	["a/*", "a/b/c", false],
	["a/**", "a/b/c", true],
] as const)("glob %s と %s", (pattern, path, matches) => {
	expect(matchPath(pattern, path)).toBe(matches);
});

it("外部Read・外部Write・秘密情報を拒否し、通常ファイルとルール内例外は通す", async () => {
	const h = await fixture();
	const config = defaultGuardrails();
	for (const [input, action] of [
		["normal.txt", "allow"],
		[".env", "deny"],
		["sub/.env.example", "allow"],
		[join(h.outside, "normal.txt"), "deny"],
		[".ssh/key", "deny"],
	] as const) {
		expect(
			(
				await evaluateGuardrails(config, h.cwd, [h.cwd], {
					tool: "read",
					cwd: ".",
					input,
				})
			).action,
		).toBe(action);
	}
	config.pathAccess.outsideRead = "allow";
	expect(
		(
			await evaluateGuardrails(config, h.cwd, [h.cwd], {
				tool: "write",
				cwd: ".",
				input: join(h.outside, "a"),
			})
		).action,
	).toBe("deny");
	expect(
		(
			await evaluateGuardrails(config, h.cwd, [h.cwd], {
				tool: "write",
				cwd: ".",
				input: ".pi/guardrails.json",
			})
		).action,
	).toBe("deny");
});

it("別ルールのallowはdenyを解除せず、例外は所属ルールだけに作用する", async () => {
	const h = await fixture();
	const config = defaultGuardrails();
	config.pathRules.push({
		...config.pathRules[0]!,
		id: "allow-env",
		action: "allow",
	});
	expect(guardrailWarnings(config)).toHaveLength(1);
	expect(
		(
			await evaluateGuardrails(config, h.cwd, [h.cwd], {
				tool: "read",
				cwd: ".",
				input: ".env",
			})
		).action,
	).toBe("deny");
});

it("複合コマンドの危険操作と追加拒否ルールを検出し、未知のスクリプトはaskにする", async () => {
	const h = await fixture();
	const config = defaultGuardrails();
	config.commandRules.push({
		id: "reset",
		shell: "any",
		match: "contains",
		pattern: "git reset --hard",
		action: "deny",
		reason: "破棄は禁止",
	});
	const run = (input: string) =>
		evaluateGuardrails(config, h.cwd, [h.cwd], {
			tool: "powershell",
			cwd: ".",
			input,
		});
	expect((await run("git status; git reset --hard")).action).toBe("deny");
	expect(
		(await run("Write-Output ok; Remove-Item -Recurse -Force ./cache"))
			.rules,
	).toContain("builtin:destructive");
	expect((await run("node ./script.js")).action).toBe("ask");
	expect(
		(await run(`Get-Content '${join(h.outside, "secret")}'`)).action,
	).toBe("deny");
});

it("junctionの実体が外部ならreadを拒否する", async () => {
	const h = await fixture();
	await symlink(h.outside, join(h.cwd, "link"), "junction");
	const result = await evaluateGuardrails(
		defaultGuardrails(),
		h.cwd,
		[h.cwd],
		{ tool: "read", cwd: ".", input: "link/secret" },
	);
	expect(result.action).toBe("deny");
	expect(result.paths).toContain(join(h.outside, "secret"));
});

it("Shellの外部書込みと保護対象を、外部Readの許可で通過させない", async () => {
	const h = await fixture();
	const config = defaultGuardrails();
	config.pathAccess.outsideRead = "allow";
	const run = (input: string) =>
		evaluateGuardrails(config, h.cwd, [h.cwd], {
			tool: "powershell",
			cwd: ".",
			input,
		});
	expect((await run("Get-Content .env")).action).toBe("deny");
	expect(
		(
			await run(
				"Set-Content -LiteralPath ../outside/file.txt -Value example",
			)
		).action,
	).toBe("deny");
	expect((await run("Get-Content ../outside/file.txt")).action).toBe("ask");
});

it("workspace内のallowルールでjunction先の外部Readを許可しない", async () => {
	const h = await fixture();
	await symlink(h.outside, join(h.cwd, "link"), "junction");
	const config = defaultGuardrails();
	config.pathRules.push({
		id: "link",
		base: "workspace",
		match: "directory",
		pattern: "link",
		operations: ["read"],
		action: "allow",
		exceptions: [],
		reason: "内部の資料",
	});
	expect(
		(
			await evaluateGuardrails(config, h.cwd, [h.cwd], {
				tool: "read",
				cwd: ".",
				input: "link/file",
			})
		).action,
	).toBe("deny");
});

it("denyでは承認を表示せず、設定変更で発行済み許可を失効させる", async () => {
	const h = await fixture();
	const authorize = vi.fn(() =>
		Promise.resolve(new AbortController().signal),
	);
	await expect(
		approveToolCall(
			{
				tool: "read",
				params: { path: ".env" },
				cwd: h.cwd,
				policy: h.policy,
			},
			authorize,
		),
	).rejects.toThrow("拒否");
	expect(authorize).not.toHaveBeenCalled();
	const permit = await approveToolCall(
		{
			tool: "powershell",
			params: { command: "git status" },
			command: ["powershell", "git status"],
			cwd: h.cwd,
			policy: h.policy,
		},
		authorize,
	);
	guardrailRegistry.apply(h.cwd, defaultGuardrails());
	expect(() => consumeApprovedToolCall(permit)).toThrow("再承認");
});

it("承認待ちの設定変更はsignalを取り消し、後から許可しても発行しない", async () => {
	const h = await fixture();
	const gate = pending<AbortSignal>();
	let approvalSignal: AbortSignal | undefined;
	const authorize = vi.fn((_presentation, signal?: AbortSignal) => {
		approvalSignal = signal;
		return gate.promise;
	});
	const approval = approveToolCall(
		{ tool: "write", params: { path: "a" }, cwd: h.cwd, policy: h.policy },
		authorize,
	);
	await vi.waitFor(() => expect(authorize).toHaveBeenCalled());
	guardrailRegistry.apply(h.cwd, defaultGuardrails());
	expect(approvalSignal?.aborted).toBe(true);
	gate.resolve(new AbortController().signal);
	await expect(approval).rejects.toThrow("再承認");
});

it("設定ファイルを直接書き換えても実効設定は変わらない", async () => {
	const h = await fixture();
	const before = guardrailRegistry.snapshot(h.cwd, [h.cwd]);
	await mkdir(join(h.cwd, ".pi"));
	await writeFile(
		join(h.cwd, ".pi/guardrails.json"),
		JSON.stringify({
			...defaultGuardrails(),
			pathAccess: { outsideRead: "allow", outsideWrite: "deny" },
		}),
	);
	expect(guardrailRegistry.snapshot(h.cwd, [h.cwd]).digest).toBe(
		before.digest,
	);
});

it("子がcwdを別ルートへ移しても親のガードレールを維持する", async () => {
	const h = await fixture();
	await h.trustStore.setUserTrust(h.outside, true);
	const config = defaultGuardrails();
	config.commandRules.push({
		id: "parent-deny",
		shell: "any",
		match: "contains",
		pattern: "git reset",
		action: "deny",
		reason: "親の制限",
	});
	guardrailRegistry.apply(h.cwd, config);
	guardrailRegistry.apply(h.outside, defaultGuardrails());
	const authorize = vi.fn(() =>
		Promise.resolve(new AbortController().signal),
	);
	await expect(
		approveToolCall(
			{
				tool: "powershell",
				params: { command: "git reset --hard" },
				command: ["powershell", "git reset --hard"],
				cwd: h.outside,
				policy: {
					...h.policy,
					workspaceRoots: [h.cwd, h.outside],
					guardrailsRoot: h.cwd,
				},
			},
			authorize,
		),
	).rejects.toThrow("親の制限");
	expect(authorize).not.toHaveBeenCalled();
});

it("実SDKのreadで通常ファイルを読み、外部読取りを拒否する", async () => {
	const h = await fixture();
	const authorize = vi.fn(() =>
		Promise.resolve(new AbortController().signal),
	);
	await writeFile(join(h.cwd, "normal.txt"), "hello");
	await writeFile(join(h.outside, "secret.txt"), "secret");
	const tool = createPiReadTool(
		sdk,
		"read",
		h.paths,
		authorize,
		new AbortController().signal,
	);
	const rawContext: unknown = { cwd: h.cwd };
	const context = rawContext as Parameters<typeof tool.execute>[4];
	expect(
		JSON.stringify(
			await tool.execute(
				"a",
				{ path: "normal.txt" },
				undefined,
				undefined,
				context,
			),
		),
	).toContain("hello");
	await expect(
		tool.execute(
			"b",
			{ path: join(h.outside, "secret.txt") },
			undefined,
			undefined,
			context,
		),
	).rejects.toThrow("拒否");
	expect(authorize).not.toHaveBeenCalled();
});

it("承認中に外部junctionの接続先が変わったらreadを実行しない", async () => {
	const h = await fixture();
	const config = defaultGuardrails();
	config.pathAccess.outsideRead = "ask";
	guardrailRegistry.apply(h.cwd, config);
	await writeFile(join(h.outside, "a"), "old");
	await mkdir(join(h.outside, "other"));
	await writeFile(join(h.outside, "other/a"), "new");
	const link = join(h.cwd, "link");
	await symlink(h.outside, link, "junction");
	const gate = pending<AbortSignal>();
	const authorize = vi.fn(() => gate.promise);
	const tool = createPiReadTool(
		sdk,
		"read",
		h.paths,
		authorize,
		new AbortController().signal,
	);
	const rawContext: unknown = { cwd: h.cwd };
	const result = tool.execute(
		"a",
		{ path: "link/a" },
		undefined,
		undefined,
		rawContext as Parameters<typeof tool.execute>[4],
	);
	await vi.waitFor(() => expect(authorize).toHaveBeenCalled());
	await unlink(link);
	await symlink(join(h.outside, "other"), link, "junction");
	gate.resolve(new AbortController().signal);
	await expect(result).rejects.toThrow("再承認");
});

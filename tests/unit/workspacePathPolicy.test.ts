// 実filesystemでpath escape・junction・新規path・権限の交差を検証する。
import {
	mkdtemp,
	mkdir,
	realpath,
	rm,
	symlink,
	writeFile,
	link,
} from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, parse } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	createWorkspaceAccessPolicy,
	WorkspacePathPolicy,
	canonicalPath,
} from "../../src/extension/security/WorkspacePathPolicy";
import {
	intersectAccessPolicies,
	containsPath,
	policyWorkspaceRoots,
} from "../../src/extension/security/AgentAccessPolicy";

let base: string;
let root: string;
let outside: string;
let paths: WorkspacePathPolicy;
beforeEach(async () => {
	base = await realpath(await mkdtemp(join(tmpdir(), "nerita-policy-")));
	root = join(base, "workspace");
	outside = join(base, "workspace-other");
	await Promise.all([mkdir(root), mkdir(outside)]);
	paths = new WorkspacePathPolicy(
		await createWorkspaceAccessPolicy([root]),
		root,
	);
});
afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(base, { recursive: true, force: true });
});

it.each([false, true])(
	"移設CODEX_HOMEを保護する（存在=%s）",
	async (exists) => {
		const relocated = join(root, "codex-config");
		if (exists) {
			await mkdir(relocated);
			await writeFile(join(relocated, "auth.json"), "synthetic");
		}
		vi.stubEnv("CODEX_HOME", relocated);
		const relocatedPaths = new WorkspacePathPolicy(
			await createWorkspaceAccessPolicy([root]),
			root,
		);
		for (const operation of ["read", "write"] as const) {
			await expect(
				relocatedPaths.resolve(join(relocated, "auth.json"), operation),
			).rejects.toThrow("保護");
		}
	},
);
it("CODEX_HOMEのjunction指定は実体側も保護する", async () => {
	const alias = join(root, "codex-alias");
	await symlink(outside, alias, "junction");
	vi.stubEnv("CODEX_HOME", alias);
	const policy = await createWorkspaceAccessPolicy([root, outside]);
	const relocated = new WorkspacePathPolicy(policy, root);
	await expect(
		relocated.resolve(join(outside, "auth.json"), "read"),
	).rejects.toThrow("保護");
	await expect(
		relocated.resolve(join(alias, "auth.json"), "write"),
	).rejects.toThrow("保護");
});
it("相対CODEX_HOMEを推測せずpolicy生成を拒否する", async () => {
	vi.stubEnv("CODEX_HOME", "relative-codex");
	await expect(createWorkspaceAccessPolicy([root])).rejects.toThrow(
		"CODEX_HOME",
	);
});

it("新規階層は実在する祖先から解決しworkspace内だけ許可する", async () => {
	expect(await paths.resolve("new/deep/file.txt", "write")).toBe(
		join(root, "new/deep/file.txt"),
	);
	await expect(
		paths.resolve("../workspace-other/target", "write"),
	).rejects.toThrow("境界");
	await expect(paths.resolve(join(outside, "target"), "read")).resolves.toBe(
		join(outside, "target"),
	);
	await expect(paths.resolveWorkspace(outside)).rejects.toThrow("境界");
});
it("junctionを経由した新規ファイルもworkspace外へ出られない", async () => {
	await symlink(outside, join(root, "escape"), "junction");
	await expect(paths.resolve("escape/new/file", "write")).rejects.toThrow(
		"境界",
	);
	await expect(paths.resolve("escape", "read")).resolves.toBe(outside);
	await expect(paths.resolveWorkspace("escape")).rejects.toThrow("境界");
});
it("dangling junctionを新規pathとして許可しない", async () => {
	await symlink(outside, join(root, "broken"), "junction");
	await rm(outside, { recursive: true });
	await expect(paths.resolve("broken/file", "write")).rejects.toThrow();
});
it("hard linkから別pathのファイルを書き換えない", async () => {
	await writeFile(join(outside, "secret"), "original");
	await link(join(outside, "secret"), join(root, "hard"));
	await expect(paths.resolve("hard", "write")).rejects.toThrow("hard link");
});
it("multi-rootとprotected pathを区別する", async () => {
	const policy = await createWorkspaceAccessPolicy([root, outside]);
	policy.filesystem.protectedPaths = [join(root, "private")];
	const multi = new WorkspacePathPolicy(policy, root);
	expect(await multi.resolve(join(outside, "file"), "write")).toBe(
		join(outside, "file"),
	);
	await expect(multi.resolve("private/secret", "read")).rejects.toThrow(
		"保護",
	);
	await expect(multi.resolve(root, "write")).rejects.toThrow("root");
});
it("解決できないrootとdrive root・home全体を拒否する", async () => {
	await expect(createWorkspaceAccessPolicy([])).rejects.toThrow();
	await expect(
		createWorkspaceAccessPolicy([join(base, "missing")]),
	).rejects.toThrow();
	await expect(
		createWorkspaceAccessPolicy([parse(root).root]),
	).rejects.toThrow();
	await expect(createWorkspaceAccessPolicy([homedir()])).rejects.toThrow();
});
it.skipIf(process.platform !== "win32")(
	"Windowsのcase・separator・特殊pathを検査する",
	async () => {
		expect(
			await paths.resolve(
				root.toUpperCase().replaceAll("\\", "/"),
				"read",
			),
		).toBe(root);
		for (const path of [
			"a:secret",
			"a:stream",
			"x::$DATA",
			"file:stream/child",
			"C:relative",
			"COM¹.txt",
			"CONOUT$",
			"bad\x01name",
			"\\\\server\\share\\file",
			"NUL.txt",
			"file. ",
			"\\\\?\\C:\\secret",
		]) {
			await expect(paths.resolve(path, "write")).rejects.toThrow();
		}
		expect(
			containsPath(
				"\\\\server\\share\\root",
				"\\\\server\\share\\root-other\\file",
			),
		).toBe(false);
		expect(
			containsPath(
				"\\\\server\\share\\root",
				"\\\\SERVER\\SHARE\\root\\file",
			),
		).toBe(true);
	},
);
it("子policyは親のread・write・network・command上限を超えない", async () => {
	const childRoot = await canonicalPath("sub", root);
	const role = {
		...paths.policy,
		filesystem: {
			readableRoots: [childRoot, outside],
			writableRoots: [],
			protectedPaths: [],
		},
		network: { enabled: true },
		command: { mode: "host" as const },
	};
	const child = intersectAccessPolicies(paths.policy, role);
	expect(child.filesystem.readableRoots).toEqual([childRoot, outside]);
	expect(child.filesystem.readAccess).toBe("roots");
	expect(policyWorkspaceRoots(child)).toEqual([childRoot]);
	expect(child.filesystem.writableRoots).toEqual([]);
	expect(child.network.enabled).toBe(false);
	expect(child.command.mode).toBe("sandboxed");
	expect(child.command.readAccess).toBe("workspace");
});

it("制限された親のread範囲を、全域readのroleから拡大しない", async () => {
	const restricted = {
		...paths.policy,
		filesystem: {
			...paths.policy.filesystem,
			readAccess: "roots" as const,
		},
	};
	for (const policy of [
		intersectAccessPolicies(restricted, paths.policy),
		intersectAccessPolicies(paths.policy, restricted),
	]) {
		expect(policy.filesystem.readAccess).toBe("roots");
		await expect(
			new WorkspacePathPolicy(policy, root).resolve(outside, "read"),
		).rejects.toThrow("境界");
	}
	const deny = {
		...restricted,
		filesystem: { ...restricted.filesystem, readableRoots: [] },
	};
	await expect(
		new WorkspacePathPolicy(
			intersectAccessPolicies(deny, paths.policy),
			root,
		).resolve(root, "read"),
	).rejects.toThrow("境界");
});

it("Shellの全域readは親とrole双方の明示許可が必要", () => {
	expect(paths.policy.command).toEqual({
		mode: "sandboxed",
		readAccess: "all",
	});
	const allowed = intersectAccessPolicies(paths.policy, paths.policy);
	expect(allowed.command.readAccess).toBe("all");
	const restricted = {
		...paths.policy,
		command: {
			mode: "sandboxed" as const,
			readAccess: "workspace" as const,
		},
	};
	expect(
		intersectAccessPolicies(restricted, allowed).command.readAccess,
	).toBe("workspace");
	expect(
		intersectAccessPolicies(allowed, restricted).command.readAccess,
	).toBe("workspace");
	expect(
		intersectAccessPolicies(allowed, {
			...allowed,
			command: { mode: "deny", readAccess: "all" },
		}).command.mode,
	).toBe("deny");
});

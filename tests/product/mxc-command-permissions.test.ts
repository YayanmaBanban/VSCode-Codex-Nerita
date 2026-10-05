// 弱い承認の流用・保存失敗時の権限追加・別セッションへの持越しを防ぐ。
import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	CommandGrant,
	CommandPermissionKey,
} from "@nerita/shared/commandPermission";
import { CommandPermissions } from "../../apps/vscode-nerita/src/extension/runtime/CommandPermissions";
import { classifyToolCommand } from "../../apps/vscode-nerita/src/extension/runtime/LogicalToolCommand";
import { toolExecutionRoute } from "../../apps/vscode-nerita/src/extension/runtime/ToolExecutionRoute";

const permission: CommandPermissionKey = {
	tool: "pnpm",
	commandClass: "read-only-ish",
	workspace: process.cwd(),
	route: "host",
};

void test("pnpm の照会・実行・依存変更を分離し、不明なオプションを照会承認で許可しない", () => {
	for (const args of [
		["--version"],
		["list", "--json"],
		["why", "@scope/package"],
		["root"],
		["bin"],
	]) {
		assert.equal(classifyToolCommand("pnpm", args), "read-only-ish");
	}
	for (const args of [
		["run", "lint"],
		["test"],
		["build"],
		["exec", "node", "script.js"],
	]) {
		assert.equal(classifyToolCommand("pnpm", args), "execution");
	}
	for (const args of [
		[],
		["install"],
		["dlx", "tool"],
		["view", "package"],
		["--dir", "elsewhere", "list"],
		["list", "--config.pnpmfile=hook.cjs"],
		["unknown"],
		["--version", "install"],
	]) {
		assert.equal(classifyToolCommand("pnpm", args), "installation-network");
	}
	assert.equal(
		classifyToolCommand("unknown-tool", ["--version"]),
		"installation-network",
	);
});

void test("実行形式を変えても論理権限は同一で、既知の native pnpm だけ互換性イベントを返す", () => {
	const invocation = {
		tool: "pnpm",
		entrypoint: "pnpm.exe",
		args: ["--version"],
		workspace: process.cwd(),
	};
	const native = toolExecutionRoute(invocation, "mxc");
	assert.equal(native.permission.route, "host");
	assert.equal(native.compatibility?.code, "native-pnpm-dos-path");
	for (const entrypoint of ["pnpm.cjs", "pnpm.mjs"]) {
		const compatible = toolExecutionRoute(
			{ ...invocation, entrypoint },
			"mxc",
		);
		assert.equal(compatible.compatibility, undefined);
		assert.deepEqual(compatible.permission, {
			...native.permission,
			route: "mxc",
		});
	}
	assert.equal(
		toolExecutionRoute(invocation, "docker").permission.route,
		"docker",
	);
	assert.equal(
		toolExecutionRoute(
			{ ...invocation, tool: "git", entrypoint: "git.exe" },
			"mxc",
		).compatibility,
		undefined,
	);
});

void test("承認キーの全要素を照合し、今回だけ・セッション・ワークスペースの寿命を分離する", async () => {
	let saved: CommandGrant[] = [];
	const storage = {
		read: () => saved,
		write: (value: CommandGrant[]) => {
			saved = structuredClone(value);
			return Promise.resolve();
		},
	};
	const permissions = new CommandPermissions(storage);
	await permissions.allow(permission, "once");
	assert.equal(permissions.has(permission), false);
	await permissions.allow(permission, "session");
	assert.equal(permissions.has(permission), true);
	assert.equal(new CommandPermissions(storage).has(permission), false);
	for (const change of [
		{ tool: "git" },
		{ commandClass: "execution" as const },
		{ commandClass: "installation-network" as const },
		{ workspace: "another-workspace" },
		{ route: "mxc" as const },
	]) {
		assert.equal(permissions.has({ ...permission, ...change }), false);
	}
	await permissions.clearSession();
	assert.equal(permissions.has(permission), false);
	await permissions.allow(permission, "workspace");
	const restored = new CommandPermissions(storage);
	assert.equal(restored.has(permission), true);
	const running = restored.signal(permission);
	restored.list()[0]!.permission.commandClass = "installation-network";
	assert.equal(
		restored.has({ ...permission, commandClass: "installation-network" }),
		false,
	);
	await restored.revoke(permission);
	assert.equal(running.aborted, true);
	assert.equal(restored.signal(permission).aborted, false);
	assert.equal(new CommandPermissions(storage).has(permission), false);
});

void test("保存に失敗した承認と不正な保存形式を許可へ変換しない", async () => {
	const permissions = new CommandPermissions({
		read: () => [
			{
				permission: { ...permission, route: "unknown" },
				scope: "workspace",
			},
		],
		write: () => Promise.reject(new Error("storage failed")),
	});
	assert.equal(permissions.has(permission), false);
	await assert.rejects(
		permissions.allow(permission, "workspace"),
		/storage failed/,
	);
	assert.equal(permissions.has(permission), false);
});

// Host の拒否操作を通し、権限の寿命・保存失敗・別呼出しへの流用禁止を検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, realpath, writeFile, rename, symlink } from "node:fs/promises";
import { join } from "node:path";
import type {
	DenialEvent,
	ResourceScope,
	ResourcePolicy,
} from "@nerita/shared/sandboxPolicy";
import { sandboxRequestSchema } from "@nerita/shared/sandboxManagement";
import { SandboxManagement } from "../../apps/vscode-nerita/src/extension/runtime/SandboxManagement";
import { toolResource } from "../../apps/vscode-nerita/src/extension/runtime/DevToolDiscovery";
import {
	freezeToolCall,
	type ToolCall,
} from "../../apps/vscode-nerita/src/extension/security/ApprovedToolCall";
import type { ResourceGrantStorage } from "../../apps/vscode-nerita/src/extension/runtime/ResourceGrantStore";
import { piFixture } from "../support/pi";
import type { DevToolPolicy } from "../../apps/vscode-nerita/src/extension/runtime/DevToolPolicy";

void test("保存済み権限の対象が junction に差し替わったら再実行を拒否する", async (t) => {
	const f = await piFixture(t);
	const profilePath = join(f.root, "sdk");
	await mkdir(profilePath);
	await writeFile(join(profilePath, "helper.json"), "{}");
	const profile = await realpath(profilePath);
	const target = await realpath(join(profile, "helper.json"));
	const resource = toolResource("helper", profile, "sample", "profile");
	const manager = new SandboxManagement(
		{ read: () => [], write: () => Promise.resolve() },
		{ read: () => undefined, write: () => Promise.resolve() },
	);
	const call = fixtureCall(await realpath(f.cwd));
	const waiting = manager.waitForDecision(
		{
			events: [
				{
					id: "denied",
					target,
					requestedAccess: "read",
					resourceType: "file",
					resource,
				},
			],
			status: "reported",
			truncated: false,
		},
		call,
		"operation",
		new AbortController().signal,
	);
	await manager.decide({
		denialEventId: "denied",
		action: "allow",
		scope: "workspace",
	});
	assert.equal(await waiting, true);
	const moved = join(f.root, "moved-sdk");
	await rename(profile, moved);
	await symlink(moved, profile, "junction");
	await assert.rejects(
		manager.resourceGrants.apply(
			{ resources: [resource], environment: {}, executables: {} },
			call,
			"operation",
		),
		/パスが変更/,
	);
});

for (const scope of ["process", "session", "workspace"] as const) {
	void test(`拒否操作だけで ${scope} 権限を適用し、対象操作と寿命を守る`, async (t) => {
		const f = await piFixture(t);
		const profile = join(f.root, "sdk");
		await mkdir(profile);
		const target = join(profile, "helper.json");
		await writeFile(target, "{}");
		const resource = toolResource(
			"config",
			await realpath(profile),
			"sample",
			"profile",
		);
		const call = fixtureCall(await realpath(f.cwd));
		const event: DenialEvent = {
			id: "denial",
			target: await realpath(target),
			resourceType: "file",
			requestedAccess: "read",
			resource,
			estimatedTool: "sample",
		};
		let saved: unknown;
		const storage: ResourceGrantStorage = {
			read: () => saved,
			write: (next) => {
				saved = structuredClone(next);
				return Promise.resolve();
			},
		};
		const manager = new SandboxManagement(
			{ read: () => [], write: () => Promise.resolve() },
			storage,
		);
		const controller = new AbortController();
		const waiting = manager.waitForDecision(
			{ events: [event], status: "reported", truncated: false },
			call,
			"original-operation",
			controller.signal,
		);
		assert.equal(
			manager.snapshot().resourceGrants.length,
			0,
			"イベント登録で自動昇格しない",
		);
		await manager.decide({
			denialEventId: event.id,
			action: "allow",
			scope,
		});
		assert.equal(await waiting, true);
		await assert.rejects(
			manager.decide({ denialEventId: event.id, action: "allow", scope }),
			/期限切れ/,
		);

		const policy = {
			resources: [resource],
			environment: {},
			executables: {},
		};
		const applied = await manager.resourceGrants.apply(
			policy,
			call,
			"original-operation",
		);
		assert.equal(applied.resources.at(-1)!.source, "denial");
		assert.equal(applied.resources.at(-1)!.access, "read");
		await verifyGrantIsolation(
			manager,
			policy,
			resource,
			call,
			f.root,
			scope,
		);
		await verifyGrantLifetime(manager, storage, scope);
	});
}

/** 実行終了・接続終了・別インスタンスでの復元を順番に確認する。 */
async function verifyGrantLifetime(
	manager: SandboxManagement,
	storage: ResourceGrantStorage,
	scope: ResourceScope,
) {
	await manager.resourceGrants.finish("original-operation");
	assert.equal(
		manager.snapshot().resourceGrants.length,
		scope === "process" ? 0 : 1,
	);
	await manager.clearSession();
	assert.equal(
		manager.snapshot().resourceGrants.length,
		scope === "workspace" ? 1 : 0,
	);
	const restored = new SandboxManagement(
		{ read: () => [], write: () => Promise.resolve() },
		storage,
	);
	assert.equal(
		restored.snapshot().resourceGrants.length,
		scope === "workspace" ? 1 : 0,
	);
}

void test("保存・取消しに失敗しても Host の状態を変えず、成功後にだけ再実行へ進む", async (t) => {
	const f = await piFixture(t);
	const target = join(f.cwd, "helper.json");
	await writeFile(target, "{}");
	let failing = true;
	const manager = new SandboxManagement(
		{ read: () => [], write: () => Promise.resolve() },
		{
			read: () => undefined,
			write: () =>
				failing
					? Promise.reject(new Error("保存失敗"))
					: Promise.resolve(),
		},
	);
	const event: DenialEvent = {
		id: "denial",
		target: await realpath(target),
		resourceType: "file",
		requestedAccess: "read",
		resource: toolResource(
			"helper",
			await realpath(target),
			"sample",
			"profile",
		),
	};
	const call = fixtureCall(await realpath(f.cwd));
	const waiting = manager.waitForDecision(
		{ events: [event], status: "reported", truncated: false },
		call,
		"operation",
		new AbortController().signal,
	);
	await assert.rejects(
		manager.decide({
			denialEventId: event.id,
			action: "allow",
			scope: "workspace",
		}),
		/保存失敗/,
	);
	assert.equal(manager.snapshot().resourceGrants.length, 0);
	assert.ok(manager.snapshot().denials[0]!.actions.includes("allow"));
	failing = false;
	await manager.decide({
		denialEventId: event.id,
		action: "allow",
		scope: "workspace",
	});
	assert.equal(await waiting, true);
	const grant = manager.snapshot().resourceGrants[0]!;
	failing = true;
	await assert.rejects(manager.resourceGrants.revoke(grant.id), /保存失敗/);
	assert.equal(manager.snapshot().resourceGrants[0]!.id, grant.id);
	failing = false;
	await manager.resourceGrants.revoke(grant.id);
	assert.equal(manager.snapshot().resourceGrants.length, 0);
});

void test("キャッシュ切替は RW 権限を作らず、保存・復元・取消しができる", async (t) => {
	const f = await piFixture(t);
	let saved: unknown;
	const storage: ResourceGrantStorage = {
		read: () => saved,
		write: (next) => {
			saved = next;
			return Promise.resolve();
		},
	};
	const manager = new SandboxManagement(
		{ read: () => [], write: () => Promise.resolve() },
		storage,
	);
	const call = fixtureCall(await realpath(f.cwd));
	const event: DenialEvent = {
		id: "cache",
		target: "host-cache",
		resourceType: "file",
		requestedAccess: "write",
		resource: toolResource("cache", "host-cache", "pnpm", "profile"),
	};
	const waiting = manager.waitForDecision(
		{ events: [event], status: "reported", truncated: false },
		call,
		"operation",
		new AbortController().signal,
	);
	await assert.rejects(
		manager.decide({
			denialEventId: event.id,
			action: "allow",
			scope: "workspace",
		}),
	);
	await manager.decide({
		denialEventId: event.id,
		action: "use-sandbox-cache",
	});
	assert.equal(await waiting, true);
	assert.equal(manager.snapshot().resourceGrants.length, 0);
	assert.equal(manager.resourceGrants.usesCache(call), true);
	const restored = new SandboxManagement(
		{ read: () => [], write: () => Promise.resolve() },
		storage,
	);
	assert.equal(restored.resourceGrants.usesCache(call), true);
	assert.equal(restored.resourceGrants.usesCache(fixtureCall(f.root)), false);
	await restored.resourceGrants.revoke(
		restored.snapshot().cacheSwitches[0]!.id,
		true,
	);
	assert.equal(restored.resourceGrants.usesCache(call), false);
});

void test("UI の拒否操作は任意パスを受け付けない", () => {
	assert.equal(
		sandboxRequestSchema.safeParse({
			type: "denial-action",
			decision: {
				denialEventId: "known",
				action: "allow",
				scope: "workspace",
				target: "arbitrary",
			},
		}).success,
		false,
	);
});

void test("停止済みイベントと資格情報・診断情報には権限を追加できない", async (t) => {
	const f = await piFixture(t);
	const manager = new SandboxManagement(
		{ read: () => [], write: () => Promise.resolve() },
		{ read: () => undefined, write: () => Promise.resolve() },
	);
	const call = fixtureCall(await realpath(f.cwd));
	const event: DenialEvent = {
		id: "event",
		target: await realpath(process.execPath),
		resourceType: "file",
		requestedAccess: "execute",
		resource: toolResource(
			"helper",
			await realpath(process.execPath),
			"node",
			"profile",
		),
	};
	const controller = new AbortController();
	const waiting = manager.waitForDecision(
		{ events: [event], status: "reported", truncated: false },
		call,
		"operation",
		controller.signal,
	);
	controller.abort();
	assert.equal(await waiting, false);
	await assert.rejects(
		manager.decide({
			denialEventId: event.id,
			action: "allow",
			scope: "process",
		}),
		/期限切れ/,
	);
	for (const kind of ["credential", "environment"] as const) {
		assert.equal(
			await manager.waitForDecision(
				{
					events: [
						{ ...event, resource: { ...event.resource!, kind } },
					],
					status: "reported",
					truncated: false,
				},
				call,
				"operation",
				new AbortController().signal,
			),
			false,
		);
	}
	assert.equal(
		await manager.waitForDecision(
			{
				events: [
					{
						id: event.id,
						target: event.target,
						requestedAccess: event.requestedAccess,
						resourceType: "other",
					},
				],
				status: "reported",
				truncated: false,
			},
			call,
			"operation",
			new AbortController().signal,
		),
		false,
	);
	assert.equal(manager.snapshot().resourceGrants.length, 0);
});

/** 権限の許可条件と拒否条件を同じポリシーで確認する。 */
async function verifyGrantIsolation(
	manager: SandboxManagement,
	policy: DevToolPolicy,
	resource: ResourcePolicy,
	call: ToolCall,
	outside: string,
	scope: ResourceScope,
) {
	const differentWorkspace = await manager.resourceGrants.apply(
		policy,
		fixtureCall(outside),
		"original-operation",
	);
	assert.equal(
		differentWorkspace.resources.length,
		1,
		"別ワークスペースへ流用しない",
	);
	const differentProfile = await manager.resourceGrants.apply(
		{ ...policy, resources: [{ ...resource, tool: "different" }] },
		call,
		"original-operation",
	);
	assert.equal(
		differentProfile.resources.length,
		1,
		"別プロファイルへ流用しない",
	);
	const differentOperation = await manager.resourceGrants.apply(
		policy,
		call,
		"different-operation",
	);
	assert.equal(
		differentOperation.resources.length,
		scope === "process" ? 1 : 2,
	);
}

/** 実行条件を固定して、UI が触れられない Host の呼出しを用意する。 */
function fixtureCall(workspace: string): ToolCall {
	return freezeToolCall({
		tool: "powershell",
		params: { command: "fixture" },
		command: [process.execPath, "fixture.cjs"],
		cwd: workspace,
		timeoutMs: 1000,
		policy: {
			workspaceRoots: [workspace],
			writableRoots: [workspace],
			shell: true,
			networkAccess: false,
		},
	});
}

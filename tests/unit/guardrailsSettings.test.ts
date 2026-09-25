// 永続化・復元・適用中の変更を、実ファイルと模擬 workspaceState で検証する。
import { afterEach, expect, it, vi } from "vitest";
import type { Memento, Uri } from "vscode";
import { join } from "node:path";
import { symlink } from "node:fs/promises";
import { GuardrailsSettings } from "../../src/extension/backends/pi/guardrails/GuardrailsSettings";
import { guardrailRegistry } from "../../src/extension/security/GuardrailRegistry";
import { defaultGuardrails } from "../../src/shared/guardrails/config";
import { sandboxFixture } from "./sandboxFixtures";
import { pending } from "./piHarness";

const api = vi.hoisted(() => ({
	folder: undefined as
		| { uri: { scheme: string; fsPath: string; toString: () => string } }
		| undefined,
	showErrorMessage: vi.fn(),
}));
vi.mock("vscode", () => ({
	workspace: {
		get workspaceFolders() {
			return api.folder ? [api.folder] : [];
		},
		getWorkspaceFolder: () => api.folder,
	},
	window: { showErrorMessage: api.showErrorMessage },
	Uri: {
		joinPath: (base: { fsPath: string }, ...parts: string[]) =>
			uri(join(base.fsPath, ...parts)),
	},
}));
const fixtures: Awaited<ReturnType<typeof sandboxFixture>>[] = [];
afterEach(async () => {
	guardrailRegistry.dispose();
	api.folder = undefined;
	await Promise.all(fixtures.splice(0).map((item) => item.cleanup()));
});

/** ファイル URI の同一性だけをテスト境界で表す。 */
function uri(path: string) {
	return { scheme: "file", fsPath: path, toString: () => path };
}

/** 保存先をメモリー内に限定し、実際の利用者設定へ触れない。 */
async function fixture() {
	const h = await sandboxFixture();
	fixtures.push(h);
	api.folder = { uri: uri(h.cwd) };
	const values = new Map<string, unknown>();
	const update = vi.fn((key: string, value: unknown) => {
		values.set(key, value);
		return Promise.resolve();
	});
	const raw: unknown = { get: (key: string) => values.get(key), update };
	return {
		...h,
		values,
		update,
		settings: new GuardrailsSettings(raw as Memento),
	};
}

it("保存済み設定を復元し、壊れた設定では全Toolの許可を失効させる", async () => {
	const h = await fixture();
	const config = defaultGuardrails();
	config.pathAccess.outsideRead = "ask";
	h.values.set(`guardrails.v1:${h.cwd}`, JSON.stringify(config));
	await h.settings.restore();
	expect(
		guardrailRegistry.snapshot(h.cwd, [h.cwd]).config.pathAccess
			.outsideRead,
	).toBe("ask");
	h.values.set(`guardrails.v1:${h.cwd}`, "{ broken }");
	await h.settings.restore();
	expect(guardrailRegistry.snapshot(h.cwd, [h.cwd]).signal.aborted).toBe(
		true,
	);
	await h.settings.apply(h.cwd, JSON.stringify(config), () => true);
	expect(guardrailRegistry.snapshot(h.cwd, [h.cwd]).signal.aborted).toBe(
		false,
	);
});

it("設定適用の保存待ちで文書が変わったら以前の永続値を戻す", async () => {
	const h = await fixture();
	const original = JSON.stringify(defaultGuardrails());
	h.values.set(`guardrails.v1:${h.cwd}`, original);
	await h.settings.restore();
	const before = guardrailRegistry.snapshot(h.cwd, [h.cwd]);
	const gate = pending<void>();
	let current = true;
	h.update.mockImplementationOnce((key, value) => {
		h.values.set(key, value);
		return gate.promise;
	});
	const config = defaultGuardrails();
	config.pathAccess.outsideRead = "allow";
	const operation = h.settings.apply(
		h.cwd,
		JSON.stringify(config),
		() => current,
	);
	await vi.waitFor(() => expect(h.update).toHaveBeenCalled());
	current = false;
	gate.resolve();
	await expect(operation).rejects.toThrow("適用中");
	expect(h.values.get(`guardrails.v1:${h.cwd}`)).toBe(original);
	expect(guardrailRegistry.snapshot(h.cwd, [h.cwd]).digest).toBe(
		before.digest,
	);
});

it("設定ディレクトリが外部junctionなら保存先として扱わない", async () => {
	const h = await fixture();
	const raw: unknown = uri(join(h.cwd, ".pi/guardrails.json"));
	expect(await h.settings.rootFor(raw as Uri)).toBe(h.cwd);
	await symlink(h.outside, join(h.cwd, ".pi"), "junction");
	await expect(h.settings.rootFor(raw as Uri)).rejects.toThrow("リンク先");
});

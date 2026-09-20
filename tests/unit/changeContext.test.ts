// 実際の一時Gitリポジトリで差分範囲・除外・上限と通信境界を検証する。
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	readChangeContext,
	ChangeContextError,
} from "../../src/extension/codex/context/changeContext";
import { isUiMessage } from "../../src/shared/uiMessageValidation";
import { isChangeReference } from "../../src/shared/changeReferences";

const exec = promisify(execFile);
const configuration = vi.hoisted(() => ({ get: vi.fn(), resolve: vi.fn() }));
vi.mock("vscode", () => ({
	Uri: { file: (path: string) => ({ fsPath: path }) },
	workspace: { getConfiguration: configuration.resolve },
}));
const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
	contributes: {
		configuration: { properties: Record<string, { default: string[] }> };
	};
};
beforeEach(() => {
	configuration.resolve.mockReturnValue({ get: configuration.get });
	configuration.get.mockReturnValue(
		manifest.contributes.configuration.properties[
			"nerita.codex.changes.exclude"
		]!.default,
	);
});
const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((cwd) => rm(cwd, { recursive: true, force: true })),
	);
});
/** ユーザーのGit設定に依存しない専用リポジトリを作る。 */
async function repository() {
	const cwd = await mkdtemp(join(tmpdir(), "codex-changes-"));
	directories.push(cwd);
	const git = (...args: string[]) =>
		exec(
			"git",
			[
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.invalid",
				"-c",
				"commit.gpgsign=false",
				...args,
			],
			{ cwd, windowsHide: true },
		);
	await git("init", "-b", "main");
	await writeFile(join(cwd, "sample.txt"), "base\n");
	await git("add", ".");
	await git("commit", "-m", "base");
	return { cwd, git };
}

it("4つの範囲を区別し、main側の追加コミットをブランチ差分に含めない", async () => {
	const { cwd, git } = await repository();
	await git("checkout", "-b", "feature");
	await writeFile(join(cwd, "branch.txt"), "branch-only\n");
	await git("add", ".");
	await git("commit", "-m", "feature");
	await git("checkout", "main");
	await writeFile(join(cwd, "main.txt"), "main-only\n");
	await git("add", ".");
	await git("commit", "-m", "main");
	await git("checkout", "feature");
	await writeFile(join(cwd, "sample.txt"), "staged-value\n");
	await git("add", "sample.txt");
	await writeFile(join(cwd, "sample.txt"), "working-value\n");
	await writeFile(join(cwd, "untracked.txt"), "untracked-secret\n");
	const working = await readChangeContext(cwd, "uncommitted");
	expect(working).toContain("-staged-value");
	expect(working).toContain("+working-value");
	expect(working).not.toContain("untracked-secret");
	const staged = await readChangeContext(cwd, "staged");
	expect(staged).toContain("-base");
	expect(staged).toContain("+staged-value");
	expect(staged).not.toContain("working-value");
	const since = await readChangeContext(cwd, "since-last-commit");
	expect(since).toContain("-base");
	expect(since).toContain("+working-value");
	const branch = await readChangeContext(cwd, "branch");
	expect(branch).toContain("+branch-only");
	expect(branch).not.toContain("main-only");
	expect(branch).not.toContain("working-value");
});

it("lock・生成物を除外し、大きい差分を明示した要約へ切り替える", async () => {
	const { cwd, git } = await repository();
	await writeFile(join(cwd, "pnpm-lock.yaml"), "lock-secret");
	await mkdir(join(cwd, "dist"));
	await writeFile(join(cwd, "dist", "output.js"), "generated-secret");
	await writeFile(join(cwd, "large.txt"), "large-line\n".repeat(10_000));
	await git("add", ".");
	const value = await readChangeContext(cwd, "staged");
	expect(value).toContain("summary only");
	expect(value).toContain("large.txt");
	expect(value).not.toContain("pnpm-lock.yaml");
	expect(value).not.toContain("output.js");
	expect(value.length).toBeLessThan(61_000);
});

it("差分なしを明示し、main欠落は空の差分として送らない", async () => {
	const { cwd, git } = await repository();
	expect(await readChangeContext(cwd, "uncommitted")).toContain("No changes");
	await git("branch", "-m", "other");
	await expect(readChangeContext(cwd, "branch")).rejects.toBeInstanceOf(
		ChangeContextError,
	);
});

it("作業フォルダーの設定を毎回読み、独自パターンと空配列で既定値を置き換える", async () => {
	const { cwd, git } = await repository();
	await writeFile(join(cwd, "pnpm-lock.yaml"), "lock-content\n");
	await mkdir(join(cwd, "coverage"));
	await writeFile(join(cwd, "coverage", "report.txt"), "coverage-content\n");
	await git("add", ".");
	configuration.get.mockReturnValue(["**/coverage/**"]);
	const custom = await readChangeContext(cwd, "staged");
	expect(custom).toContain("+lock-content");
	expect(custom).not.toContain("coverage-content");
	expect(configuration.resolve).toHaveBeenLastCalledWith("nerita.codex", {
		fsPath: cwd,
	});
	expect(configuration.get).toHaveBeenLastCalledWith("changes.exclude", []);
	configuration.get.mockReturnValue([]);
	const all = await readChangeContext(cwd, "staged");
	expect(all).toContain("+lock-content");
	expect(all).toContain("+coverage-content");
	expect(all).toContain("No path exclusions are applied.");
});

it("不正な除外設定ではフィルターなしの差分を送らず失敗する", async () => {
	const { cwd } = await repository();
	configuration.get.mockReturnValue([12]);
	await expect(readChangeContext(cwd, "staged")).rejects.toBeInstanceOf(
		ChangeContextError,
	);
});

it("未知の範囲や偽のチップを通信境界で拒否する", () => {
	const message = {
		type: "prompt/send",
		requestId: "r",
		sessionId: "s",
		text: "review",
	};
	expect(isUiMessage({ ...message, changeScopes: ["staged"] })).toBe(true);
	expect(isUiMessage({ ...message, changeScopes: ["--output=bad"] })).toBe(
		false,
	);
	expect(
		isUiMessage({
			type: "changes/open",
			requestId: "r",
			scope: "__proto__",
		}),
	).toBe(false);
	expect(
		isChangeReference({ kind: "changes", scope: "staged", name: "Staged" }),
	).toBe(true);
	expect(
		isChangeReference({ kind: "changes", scope: "staged", name: "fake" }),
	).toBe(false);
});

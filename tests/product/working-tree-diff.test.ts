// 実際の Git インデックスと作業ツリーを使い、差分を開く操作とワークスペース境界を検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdir, writeFile, symlink, unlink } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { WorkingTreeDiff } from "../../apps/vscode-nerita/src/extension/webview/workingTreeDiff";
import { isUiMessage } from "@nerita/shared/uiMessageValidation";

const exec = promisify(execFile);

/** URI の構築とエディター表示だけを代替し、Git とパスの実体確認は製品処理を通す。 */
void test("ファイル名からインデックスの textconv 本文と作業ツリーを比較し、境界外・未信頼を拒否する", async () => {
	const root = join(process.env.NERITA_TEST_ROOT!, "diff-workspace");
	const outside = join(process.env.NERITA_TEST_ROOT!, "diff-outside");
	await prepareRepository(root, outside);
	const editor = prepareEditor(root);
	try {
		await verifyDiff(root, editor);
		await verifyBoundary(root, outside, editor.diff);
		assert.equal(editor.opened.length, 4);
	} finally {
		editor.diff.dispose();
		for (const boundary of [
			vscode.Uri,
			vscode.workspace,
			vscode.commands,
		]) {
			for (const key of Object.keys(boundary)) {
				Reflect.deleteProperty(boundary, key);
			}
		}
	}
});

/** 最新コミット・インデックス・作業ツリーの本文を別々にし、`textconv` の適用を確認できるようにする。 */
async function prepareRepository(root: string, outside: string) {
	await mkdir(root);
	await mkdir(outside);
	await exec("git", ["init", "--quiet"], { cwd: root, windowsHide: true });
	await git(root, ["config", "core.autocrlf", "false"]);
	await writeFile(join(root, "sample #日本語.txt"), "head version\n");
	await git(root, ["add", "."]);
	await git(root, [
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.invalid",
		"commit",
		"-qm",
		"baseline",
	]);
	await writeFile(join(root, "sample #日本語.txt"), "index version\n");
	await git(root, ["add", "sample #日本語.txt"]);
	await writeFile(join(root, "sample #日本語.txt"), "worktree version\n");
	await writeFile(join(root, ".gitattributes"), "*.txt diff=uppercase\n");
	await writeFile(
		join(root, "textconv.cjs"),
		'process.stdout.write(require("node:fs").readFileSync(process.argv[2], "utf8").toUpperCase());',
	);
	await git(root, ["config", "diff.uppercase.textconv", "node textconv.cjs"]);
}

/** 差分を開く要求を記録し、仮想ドキュメントの読み取りと終了通知を再現する。 */
function prepareEditor(root: string) {
	let provider!: vscode.TextDocumentContentProvider;
	const token: vscode.CancellationToken = {
		isCancellationRequested: false,
		onCancellationRequested: () => ({ dispose() {} }),
	};
	let close!: (document: vscode.TextDocument) => void;
	const opened: {
		before: vscode.Uri;
		after: vscode.Uri;
		title: string;
		text: string;
	}[] = [];
	Object.assign(vscode.Uri, {
		file: (path: string) => fakeUri("file", resolve(path)),
		from: ({
			scheme,
			path,
			query,
		}: {
			scheme: string;
			path: string;
			query: string;
		}) => fakeUri(scheme, path, query),
	});
	Object.assign(vscode.workspace, {
		isTrusted: true,
		getWorkspaceFolder: (uri: vscode.Uri) => {
			const path = relative(root, uri.fsPath);
			return path.startsWith("..")
				? undefined
				: { uri: fakeUri("file", root) };
		},
		registerTextDocumentContentProvider: (
			_scheme: string,
			value: vscode.TextDocumentContentProvider,
		) => {
			provider = value;
			return { dispose() {} };
		},
		onDidCloseTextDocument: (listener: typeof close) => {
			close = listener;
			return { dispose() {} };
		},
	});
	Object.assign(vscode.commands, {
		executeCommand: async (
			command: string,
			before: vscode.Uri,
			after: vscode.Uri,
			title: string,
		) => {
			assert.equal(command, "vscode.diff");
			const text = await provider.provideTextDocumentContent(
				before,
				token,
			);
			assert.ok(typeof text === "string");
			opened.push({ before, after, title, text });
			if (after.scheme === "nerita-diff") {
				assert.equal(
					await provider.provideTextDocumentContent(after, token),
					"",
				);
			}
		},
	});
	const diff = new WorkingTreeDiff();
	return { diff, opened, token, provider, close };
}

/** インデックスを更新して再度開いても、既に表示中の変更前本文を保つ。 */
async function verifyDiff(
	root: string,
	{ diff, opened, token, provider, close }: ReturnType<typeof prepareEditor>,
) {
	await diff.open("sample #日本語.txt", root);
	assert.equal(opened[0]!.text, "INDEX VERSION\n");
	assert.equal(opened[0]!.after.fsPath, join(root, "sample #日本語.txt"));
	assert.equal(opened[0]!.title, "sample #日本語.txt (作業ツリー)");
	await writeFile(join(root, "new.ts"), "new file\n");
	await diff.open(join(root, "new.ts"));
	assert.equal(opened[1]!.text, "");

	await git(root, ["add", "sample #日本語.txt"]);
	await diff.open("sample #日本語.txt", root);
	assert.equal(opened[2]!.text, "WORKTREE VERSION\n");
	assert.notEqual(opened[0]!.before.toString(), opened[2]!.before.toString());
	assert.equal(
		await provider.provideTextDocumentContent(opened[0]!.before, token),
		"INDEX VERSION\n",
	);
	// 閉じる通知では対象 URI だけを製品へ渡す。
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
	close({ uri: opened[0]!.before } as unknown as vscode.TextDocument);
	assert.throws(
		() => provider.provideTextDocumentContent(opened[0]!.before, token),
		/Unknown diff/,
	);
	await unlink(join(root, "sample #日本語.txt"));
	await diff.open("sample #日本語.txt", root);
	assert.equal(opened[3]!.text, "WORKTREE VERSION\n");
	assert.equal(opened[3]!.after.scheme, "nerita-diff");
}

/** ワークスペース外のパスとジャンクションによる外部への参照、未信頼の状態、パスの制御文字を拒否することを確認する。 */
async function verifyBoundary(
	root: string,
	outside: string,
	diff: WorkingTreeDiff,
) {
	await writeFile(join(outside, "secret.txt"), "outside\n");
	await assert.rejects(
		diff.open(join(outside, "secret.txt")),
		/outside workspace/,
	);
	await symlink(outside, join(root, "escape"), "junction");
	await assert.rejects(
		diff.open(join(root, "escape/secret.txt")),
		/outside workspace/,
	);
	Object.assign(vscode.workspace, { isTrusted: false });
	await assert.rejects(
		diff.open("sample #日本語.txt", root),
		/Unsupported diff workspace/,
	);
	assert.equal(
		isUiMessage({
			type: "diff/open",
			requestId: "diff",
			path: "sample.txt",
		}),
		true,
	);
	assert.equal(
		isUiMessage({
			type: "diff/open",
			requestId: "diff",
			path: "sample\n.txt",
		}),
		false,
	);
}

/** エディター境界で必要な URI の性質だけを与える。 */
function fakeUri(scheme: string, fsPath: string, query = "") {
	const path = fsPath.replaceAll("\\", "/");
	// 実際の VS Code を起動せず、差分表示で利用する URI 操作だけを代替する。
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
	return {
		scheme,
		fsPath,
		path,
		toString: () => `${scheme}:${path}?${query}`,
		with: (changes: { scheme?: string; query?: string }) =>
			fakeUri(changes.scheme ?? scheme, fsPath, changes.query ?? query),
	} as unknown as vscode.Uri;
}

/** 検証用のリポジトリだけに、シェルを介さず Git を実行する。 */
async function git(cwd: string, args: string[]) {
	await exec("git", args, { cwd, windowsHide: true });
}

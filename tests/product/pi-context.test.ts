// Pi のコンテキストを SDK 本体とローカル HTTP 境界へ通し、添付・差分・会話参照の内容を検証する。
import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import type { Attachment } from "@nerita/shared/composer";
import type { HostMessage } from "@nerita/shared/messages";
import { piFixture, send, finished, permission, until } from "../support/pi";
import { restoredState } from "../support/restoredState";
import { droppedAttachments } from "../../apps/vscode-nerita/src/extension/webview/droppedAttachments";
import type { PiSession } from "../../apps/vscode-nerita/src/extension/backends/pi/PiRuntime";

const png =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

void test("Pi の画像とテキストを追加・開く・削除・送信し、別プロセスで添付と元の本文を復元する", async (t) => {
	const f = await piFixture(t);
	const text = join(f.cwd, "notes.txt");
	const image = join(f.cwd, "image.png");
	await writeFile(text, "添付にだけ含まれる資料");
	await writeFile(image, Buffer.from(png, "base64"));
	const selected: Attachment[] = [text, image].map((path) => ({
		id: path,
		name: path.endsWith(".txt") ? "notes.txt" : "image.png",
		uri: pathToFileURL(path).href,
	}));
	const opened: Attachment[] = [];
	const controller = f.controller(appendImageDimensionNote, f.cwd, {
		pick: () => Promise.resolve(selected),
		drop: droppedAttachments,
		open: (file) => {
			opened.push(file);
			return Promise.resolve();
		},
	});
	await controller.connect();
	assert.equal(controller.snapshot().attachmentsSupported, true);
	const sessionId = controller.snapshot().sessionId;
	await controller.receive({
		type: "attachment/add",
		requestId: "add",
		sessionId,
	});
	assert.equal(controller.snapshot().attachments.length, 2);
	await controller.receive({
		type: "attachment/open",
		requestId: "open",
		sessionId,
		attachmentId: image,
	});
	assert.deepEqual(opened, [selected[1]]);
	await controller.receive({
		type: "attachment/remove",
		requestId: "remove",
		sessionId,
		attachmentId: image,
	});
	assert.equal(controller.snapshot().attachments.length, 1);
	await controller.receive({
		type: "attachment/add",
		requestId: "drop",
		sessionId,
		files: [{ uri: pathToFileURL(image).href }],
	});
	f.model.replies.push("添付を確認しました");
	await send(controller, "画像と資料を確認");
	const state = await finished(controller);
	assert.equal(state.run, "completed", JSON.stringify(state));
	assert.equal(state.attachments.length, 0);
	assert.ok(f.model.requests[0]!.includes("添付にだけ含まれる資料"));
	assert.ok(
		f.model.requests[0]!.includes("data:image/png;base64,"),
		f.model.requests[0],
	);
	assert.equal(state.messages[0]!.attachments?.length, 2);
	await controller.dispose();
	const restored = await restoredState(f, sessionId!);
	assert.equal(restored.messages[0]!.text, "画像と資料を確認");
	assert.deepEqual(
		restored.messages[0]!.attachments,
		state.messages[0]!.attachments,
	);
});

/** SDK の画像縮小で末尾に付く注記を再現し、添付と表示本文の対応を検証する。 */
function appendImageDimensionNote(runtime: PiSession) {
	const prompt = runtime.prompt.bind(runtime);
	runtime.prompt = (text, options) =>
		prompt(
			`${text}\n\n[Image: original 2000x2000, displayed at 1000x1000.]`,
			options,
		);
}

void test("Pi はバイナリー・過大なテキスト・画像偽装・画像非対応モデルを送信せず、添付を保持して再送できる", async (t) => {
	const f = await piFixture(t);
	let path = join(f.cwd, "binary.pdf");
	await writeFile(path, Buffer.from([0, 255]));
	const controller = f.controller(undefined, f.cwd, {
		pick: () =>
			Promise.resolve([
				{ id: "file", name: "file", uri: pathToFileURL(path).href },
			]),
		open: async () => {},
	});
	await controller.connect();
	const sessionId = controller.snapshot().sessionId;
	for (const name of ["binary.pdf", "huge.txt", "fake.png"]) {
		path = join(f.cwd, name);
		if (name === "huge.txt") {
			await writeFile(path, "a".repeat(2 * 1024 * 1024 + 1));
		}
		if (name === "fake.png") {
			await writeFile(path, "not an image");
		}
		await controller.receive({
			type: "attachment/remove",
			requestId: `remove-${name}`,
			sessionId,
			attachmentId: "file",
		});
		await controller.receive({
			type: "attachment/add",
			requestId: `add-${name}`,
			sessionId,
		});
		await send(controller, "失敗時は下書きを維持");
		assert.equal((await finished(controller)).run, "failed");
		assert.equal(controller.snapshot().attachments.length, 1);
		assert.equal(f.model.requests.length, 0);
	}
	await controller.dispose();
	path = join(f.cwd, "image.png");
	await writeFile(path, Buffer.from(png, "base64"));
	const textOnly = f.controller(
		(runtime) => {
			assert.ok(runtime.model);
			runtime.model.input = ["text"];
		},
		f.cwd,
		{
			pick: () =>
				Promise.resolve([
					{
						id: "image",
						name: "image.png",
						uri: pathToFileURL(path).href,
					},
				]),
			open: async () => {},
		},
	);
	await textOnly.connect();
	await textOnly.receive({
		type: "attachment/add",
		requestId: "text-only-image",
		sessionId: textOnly.snapshot().sessionId,
	});
	await send(textOnly, "非対応モデル");
	assert.equal((await finished(textOnly)).run, "failed");
	assert.equal(textOnly.snapshot().attachments.length, 1);
	assert.equal(f.model.requests.length, 0);
	await textOnly.receive({
		type: "attachment/remove",
		requestId: "recover",
		sessionId: textOnly.snapshot().sessionId,
		attachmentId: "image",
	});
	f.model.replies.push("復旧しました");
	await send(textOnly, "添付を外して再送");
	assert.equal((await finished(textOnly)).run, "completed");
});

void test("Pi の添付送信後の追加指示では、送信済みの添付を重複して追加しない", async (t) => {
	const f = await piFixture(t);
	const image = join(f.cwd, "steer.png");
	const text = join(f.cwd, "steer.txt");
	await writeFile(image, Buffer.from(png, "base64"));
	await writeFile(text, "追加指示専用の資料");
	const controller = f.controller(undefined, f.cwd, {
		pick: () =>
			Promise.resolve(
				[image, text].map((path) => ({
					id: path,
					name: path,
					uri: pathToFileURL(path).href,
				})),
			),
		open: async () => {},
	});
	await controller.connect();
	await controller.receive({
		type: "attachment/add",
		requestId: "steer-files",
		sessionId: controller.snapshot().sessionId,
	});
	f.model.replies.push(
		{
			name: "write",
			arguments: { path: "after.txt", content: "approved" },
		},
		"追加資料も確認しました",
	);
	await send(controller, "最初の指示");
	await until(() => controller.snapshot().permissions.length > 0);
	const request = await send(controller, "追加の確認");
	await until(
		() => controller.snapshot().messages.at(-1)?.text === request.text,
	);
	await permission(controller, "accept");
	assert.equal((await finished(controller)).run, "completed");
	assert.ok(f.model.requests[1]!.includes("追加の確認"));
	assert.ok(
		f.model.requests[1]!.includes("data:image/png;base64,"),
		f.model.requests[1],
	);
	assert.ok(f.model.requests[1]!.includes("追加指示専用の資料"));
	assert.equal(controller.snapshot().attachments.length, 0);
	assert.equal(
		controller
			.snapshot()
			.messages.find((message) => message.text === request.text)
			?.attachments?.length,
		0,
	);
});

void test("Pi は保存先を切り替えても同じ作業場所の会話を検索し、原文とハンドオフを送信する", async (t) => {
	const f = await piFixture(t);
	f.storage("global");
	const source = f.controller();
	await source.connect();
	f.model.replies.push("別保存先の回答");
	await send(source, "グローバル保存の参照元");
	const sourceId = (await finished(source)).sessionId!;
	await source.dispose();
	f.storage("workspace");
	const target = f.controller();
	const events: HostMessage[] = [];
	target.subscribe((event) => events.push(event));
	await target.connect();
	await target.receive({
		type: "session/searchReferences",
		requestId: "search",
		query: "",
	});
	const result = events.find((event) => event.type === "session/references");
	assert.ok(result?.type === "session/references");
	assert.ok(result.entries.some((entry) => entry.sessionId === sourceId));
	for (const mode of ["transcript", "handoff"] as const) {
		f.model.replies.push(
			...(mode === "handoff"
				? ["保存先をまたぐ要約", "要約を確認"]
				: ["原文を確認"]),
		);
		await target.receive({
			type: "prompt/send",
			requestId: mode,
			sessionId: target.snapshot().sessionId,
			text: "資料を参照",
			sessionReferences: [{ sessionId: sourceId, mode }],
		});
		assert.equal((await finished(target)).run, "completed");
		assert.ok(
			f.model.requests
				.at(-1)!
				.includes(
					mode === "handoff"
						? "保存先をまたぐ要約"
						: "グローバル保存の参照元",
				),
		);
	}
});

void test("Pi の Git チップは全範囲をプレビュー・送信し、シンボル範囲の現在のコードも資料として渡す", async (t) => {
	const f = await piFixture(t);
	await prepareGitContext(f.cwd);
	const previews: string[] = [];
	contextDocumentBoundary(previews);
	const controller = f.controller();
	await controller.connect();
	const scopes = [
		"uncommitted",
		"staged",
		"since-last-commit",
		"branch",
	] as const;
	for (const scope of scopes) {
		await controller.receive({
			type: "changes/open",
			requestId: `preview-${scope}`,
			scope,
		});
	}
	assert.equal(previews.length, scopes.length);
	assert.ok(previews[0]!.includes("worktree-context"));
	assert.ok(previews[1]!.includes("staged-context"));
	assert.ok(previews[3]!.includes("branch-context"));
	f.model.replies.push("差分とコードを確認");
	await controller.receive({
		type: "prompt/send",
		requestId: "context",
		sessionId: controller.snapshot().sessionId,
		text: "変更と定義を確認",
		changeScopes: [...scopes],
		codeReferences: [
			{
				uri: pathToFileURL(join(f.cwd, "symbol.ts")).href,
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 60 },
				},
			},
		],
	});
	const result = await finished(controller);
	assert.equal(result.run, "completed", JSON.stringify(result));
	for (const expected of [
		"worktree-context",
		"staged-context",
		"branch-context",
		"current-symbol-body",
	]) {
		assert.ok(f.model.requests[0]!.includes(expected));
	}
	assert.equal(
		await readFile(join(f.cwd, "tracked.txt"), "utf8"),
		"worktree-context\n",
	);
});

/** 比較範囲を区別できるコミット・ステージ・作業ツリーを、一時領域だけに作る。 */
async function prepareGitContext(cwd: string) {
	const git = (...args: string[]) =>
		promisify(execFile)("git", args, { cwd, windowsHide: true });
	const commit = (message: string) =>
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"--quiet",
			"-m",
			message,
		);
	await git("init", "--quiet", "-b", "main");
	await writeFile(join(cwd, "tracked.txt"), "base\n");
	await git("add", "tracked.txt");
	await commit("base");
	await git("checkout", "--quiet", "-b", "feature");
	await writeFile(join(cwd, "tracked.txt"), "branch-context\n");
	await git("add", "tracked.txt");
	await commit("feature");
	await writeFile(join(cwd, "tracked.txt"), "staged-context\n");
	await git("add", "tracked.txt");
	await writeFile(join(cwd, "tracked.txt"), "worktree-context\n");
}

/** 文書の読取りとプレビューだけを代替し、バックエンドのコンテキスト処理は本番を使う。 */
function contextDocumentBoundary(previews: string[]) {
	Object.assign(vscode.Uri, {
		file: (fsPath: string) => ({ fsPath }),
		parse: (uri: string) => ({
			scheme: "file",
			query: "",
			fragment: "",
			uri,
		}),
	});
	Object.assign(vscode.workspace, {
		getConfiguration: () => ({ get: () => [] }),
		openTextDocument: (input: { content?: string }) => {
			if (input.content !== undefined) {
				return Promise.resolve({ content: input.content });
			}
			return Promise.resolve({
				getText: () =>
					"export function selectedSymbol() { return 'current-symbol-body'; }",
				validateRange: () => ({ isEqual: () => true }),
			});
		},
	});
	Object.assign(vscode.window, {
		showTextDocument: (document: { content: string }) => {
			previews.push(document.content);
			return Promise.resolve();
		},
	});
}

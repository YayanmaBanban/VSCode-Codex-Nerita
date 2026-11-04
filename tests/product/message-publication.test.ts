// 生成中は本文を順次配信し、確定・停止時には待機中の全文を即座に届ける。
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatState } from "@nerita/shared/chatState";
import type { HostMessage } from "@nerita/shared/messages";
import { applyStatePatch } from "@nerita/shared/toolUpdates";
import { isHostMessage } from "@nerita/shared/hostMessageValidation";
import { BackendRuntime } from "../../apps/vscode-nerita/src/extension/session/BackendRuntime";
import { DirectoryRuns } from "../../apps/vscode-nerita/src/extension/session/DirectoryRuns";
import { SessionState } from "../../apps/vscode-nerita/src/extension/session/sessionState";
import { piFixture, send, finished } from "../support/pi";
import {
	itemPatch,
	messagePatch,
} from "../../apps/vscode-nerita/src/extension/backends/codex/items/chatItems";

/** バックエンドが使う状態更新を、公開される通知とスナップショットで検証する。 */
class Conversation extends SessionState {
	update(patch: Partial<ChatState>) {
		this.patch(patch);
	}

	/** Codex と同じ変換経路で本文の断片を蓄積する。 */
	delta(text: string) {
		this.patch(messagePatch(this.state, "reply", text, true));
	}

	/** 本文項目の完了はターン全体の完了前にも届く。 */
	complete(text: string) {
		this.patch(
			itemPatch(
				this.state,
				{ type: "agentMessage", id: "reply", text },
				true,
			),
		);
	}
}

/** 外部バックエンドだけを置き換え、通知と予約の接続には製品の Runtime を使う。 */
class RuntimeConversation extends Conversation {
	receive(): Promise<void> {
		this.update({ run: "running" });
		return Promise.resolve();
	}
	invalidate(): void {}
	dispose(): Promise<void> {
		this.clearListeners();
		return Promise.resolve();
	}
}

void test("Runtime の本文通知は全体複製を起こさず、完了通知では予約を解放する", async (t) => {
	const session = new RuntimeConversation();
	session.update({ cwd: process.cwd(), sessionId: "session", runId: "run" });
	const directories = new DirectoryRuns();
	let released = 0;
	const release = () => {
		released++;
		return Promise.resolve();
	};
	t.mock.method(directories, "acquire", () => Promise.resolve(release));
	const runtime = new BackendRuntime(() => session, undefined, directories);
	t.after(() => runtime.dispose());
	await runtime.scope("chat").receive({
		type: "prompt/send",
		requestId: "start",
		sessionId: "session",
		text: "入力",
	});
	const snapshot = t.mock.method(session, "snapshot");
	t.mock.timers.enable({ apis: ["setTimeout"] });

	for (let index = 0; index < 100; index++) {
		session.delta("本文。");
	}
	t.mock.timers.tick(50);
	assert.equal(
		snapshot.mock.callCount(),
		0,
		"本文通知で履歴全体を複製しない",
	);
	assert.equal(released, 0);
	session.update({ run: "completed" });
	assert.ok(snapshot.mock.callCount() > 0);
	await runtime.dispose();
	assert.equal(released, 1);
});

void test("長い履歴の受信では変更本文だけを集約し、確定した全文を直ちに復元する", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const session = new Conversation();
	const history = Array.from({ length: 1000 }, (_, index) => ({
		id: `history-${index}`,
		role: "assistant" as const,
		text: "履歴。".repeat(1000),
	}));
	session.update({ run: "running", runId: "run", messages: history });
	let displayed = session.snapshot();
	const first = displayed.messages[0];
	const events: Extract<HostMessage, { type: "state/patch" }>[] = [];
	session.subscribe((event) => {
		assert.ok(isHostMessage(event));
		if (event.type === "state/patch") {
			events.push(event);
			displayed = applyStatePatch(displayed, event);
		}
	});

	for (let index = 0; index < 400; index++) {
		session.delta("本文。");
	}
	assert.equal(events.length, 1);
	t.mock.timers.tick(50);
	assert.equal(events.length, 2);
	session.complete("本文。".repeat(400));
	assert.equal(events.length, 3);
	for (const event of events) {
		assert.equal(event.patch.messages, undefined);
		assert.equal(
			event.messageUpdates?.length,
			1,
			"変更のない履歴を再送しない",
		);
		assert.ok(JSON.stringify(event).length < 2000);
	}
	assert.equal(displayed.messages.length, 1001);
	assert.equal(displayed.messages[0], first);
	assert.equal(displayed.messages.at(-1)?.text, "本文。".repeat(400));
	assert.equal(displayed.messages.at(-1)?.streaming, false);
	t.mock.timers.tick(50);
	assert.equal(events.length, 3);
	const snapshot = session.snapshot();
	snapshot.messages[0]!.text = "外部で変更";
	assert.equal(session.snapshot().messages[0]!.text, history[0]!.text);
});

for (const change of ["delete", "reorder", "switch"] as const) {
	void test(`履歴の ${change} では差分ではなく配列を置換する`, () => {
		const session = new Conversation();
		const messages = [
			{ id: "a", role: "user" as const, text: "一つ目" },
			{ id: "b", role: "assistant" as const, text: "二つ目" },
		];
		session.update({ messages });
		let displayed = session.snapshot();
		session.subscribe((event) => {
			if (event.type === "state/patch") {
				assert.ok(isHostMessage(event));
				assert.equal(event.messageUpdates, undefined);
				assert.ok(event.patch.messages);
				displayed = applyStatePatch(displayed, event);
			}
		});
		if (change === "delete") {
			session.update({ messages: messages.slice(1) });
		}
		if (change === "reorder") {
			session.update({ messages: [...messages].reverse() });
		}
		if (change === "switch") {
			session.update({ messages, sessionId: "other" });
		}
		assert.deepEqual(displayed.messages, session.snapshot().messages);
	});
}

for (const length of [100, 1000]) {
	void test(`${length}文字の生成中は順次配信し、確定時に残りを即座に届ける`, (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		const session = new Conversation();
		session.update({ run: "running", runId: "run" });
		const revision = session.snapshot().revision;
		const events: HostMessage[] = [];
		session.subscribe((event) => events.push(event));

		session.delta("あ");
		assert.equal(events.length, 1);
		for (let index = 1; index < length / 2; index++) {
			session.delta("あ");
		}
		assert.equal(events.length, 1);
		t.mock.timers.tick(50);
		assert.equal(events.length, 2);
		const partial = events.at(-1)!;
		assert.ok(partial.type === "state/patch");
		const partialMessage = partial.messageUpdates![0]!;
		assert.equal(partialMessage.text.length, length / 2);
		assert.equal(partialMessage.streaming, true);
		assert.equal(partial.baseRevision, revision + 1);
		for (let index = length / 2; index < length; index++) {
			session.delta("あ");
		}

		session.complete("あ".repeat(length));
		assert.equal(events.length, 3);
		const event = events.at(-1)!;
		assert.equal(event.type, "state/patch");
		assert.equal(event.baseRevision, partial.revision);
		const completedMessage = event.messageUpdates![0]!;
		assert.equal(completedMessage.text, "あ".repeat(length));
		assert.equal(completedMessage.streaming, false);
		assert.equal(session.snapshot().run, "running");
		t.mock.timers.tick(50);
		assert.equal(events.length, 3);
	});
}

for (const run of ["cancelled", "failed"] as const) {
	void test(`${run} 時には完了通知がなくても受信済み本文を公開する`, () => {
		const session = new Conversation();
		session.update({ run: "running", runId: "run" });
		session.delta("停止前の本文");
		session.update({ run });
		assert.equal(session.snapshot().messages[0]?.text, "停止前の本文");
		assert.equal(session.snapshot().messages[0]?.streaming, false);
	});
}

void test("本文生成中もツール状態を配信する", () => {
	const session = new Conversation();
	session.update({ run: "running", runId: "run" });
	session.delta("生成中");
	const events: HostMessage[] = [];
	session.subscribe((event) => events.push(event));
	session.update({
		tools: [
			{
				id: "tool",
				title: "処理中",
				kind: "execute",
				status: "in_progress",
				paths: [],
			},
		],
	});
	assert.equal(events.length, 1);
	assert.equal(session.snapshot().tools.length, 1);
	assert.equal(session.snapshot().messages[0]?.text, "生成中");
});

void test("Pi SDK の応答は生成中も配信し message_end 後に全文を確定する", async (t) => {
	const fixture = await piFixture(t);
	const session = fixture.controller();
	await session.connect();
	const replies: { text: string; streaming?: boolean }[] = [];
	session.subscribe((event) => {
		if (event.type === "state/patch") {
			for (const message of event.messageUpdates ??
				event.patch.messages ??
				[]) {
				if (message.role === "assistant") {
					replies.push(message);
				}
			}
		}
	});
	fixture.model.replies.push("まとめて表示する回答");
	await send(session, "回答してください");
	await finished(session);
	assert.ok(replies.length > 0);
	assert.ok(replies.some((message) => message.streaming === true));
	assert.equal(replies.at(-1)?.text, "まとめて表示する回答");
	assert.equal(replies.at(-1)?.streaming, false);
});

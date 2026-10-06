// 生成中は本文を順次配信し、確定・停止時には待機中の全文を即座に届ける。
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatState } from "@nerita/shared/chatState";
import type { HostMessage } from "@nerita/shared/messages";
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
		const partialMessage = partial.patch.messages![0]!;
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
		const completedMessage = event.patch.messages![0]!;
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
			for (const message of event.patch.messages ?? []) {
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

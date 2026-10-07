// 本番のブラウザー通信境界で、検証・参照保持・解析値・購読解除を確認する。
/// <reference lib="dom" />
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createTrustBridge,
	createVsCodeBridge,
} from "../../apps/nerita-ui/src/bridge/vscodeBridge";

void test("ブリッジは API を共有し、チャットの元参照とパネルの解析値を届け、解除後は通知しない", (t) => {
	const window = new EventTarget();
	const sent: unknown[] = [];
	let acquired = 0;
	for (const [key, value] of Object.entries({
		window,
		acquireVsCodeApi: () => {
			acquired++;
			return { postMessage: (message: unknown) => sent.push(message) };
		},
	})) {
		const original = Object.getOwnPropertyDescriptor(globalThis, key);
		Object.defineProperty(globalThis, key, { configurable: true, value });
		t.after(() => {
			if (original) {
				Object.defineProperty(globalThis, key, original);
			} else {
				Reflect.deleteProperty(globalThis, key);
			}
		});
	}
	const chat = createVsCodeBridge();
	const trust = createTrustBridge();
	const chats: unknown[] = [];
	const panels: unknown[] = [];
	const offChat = chat.subscribe((message) => chats.push(message));
	const offTrust = trust.subscribe((message) => panels.push(message));
	const message = {
		type: "state/patch",
		revision: 1,
		patch: {
			messages: [
				{ id: "message", role: "user", text: "hello", extra: true },
			],
		},
	};
	const panel = { type: "state", records: [], error: null, extra: true };
	window.dispatchEvent(new MessageEvent("message", { data: message }));
	window.dispatchEvent(new MessageEvent("message", { data: panel }));
	window.dispatchEvent(
		new MessageEvent("message", {
			data: {
				...message,
				patch: {
					messages: [
						{ ...message.patch.messages[0], references: null },
					],
				},
			},
		}),
	);
	assert.deepEqual(chats, [message]);
	assert.equal(chats[0], message);
	assert.deepEqual(panels, [{ type: "state", records: [], error: null }]);
	assert.notEqual(panels[0], panel);
	offChat();
	offTrust();
	window.dispatchEvent(new MessageEvent("message", { data: message }));
	window.dispatchEvent(new MessageEvent("message", { data: panel }));
	assert.equal(chats.length, 1);
	assert.equal(panels.length, 1);
	chat.postMessage({ type: "ui/ready" });
	trust.postMessage({ type: "refresh" });
	assert.deepEqual(sent, [{ type: "ui/ready" }, { type: "refresh" }]);
	assert.equal(acquired, 1);
});

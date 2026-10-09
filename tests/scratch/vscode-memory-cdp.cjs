// Electron の Webview ターゲットへ直接接続し、CDP で計測する。
const { EventEmitter } = require("node:events");
const { expect } = require("@playwright/test");

/** 外側の Browser セッションを通じて iframe ターゲットと通信する。 */
class FrameSession extends EventEmitter {
	constructor(browserSession, sessionId) {
		super();
		this.browserSession = browserSession;
		this.sessionId = sessionId;
		this.nextId = 0;
		this.pending = new Map();
		browserSession.on("Target.receivedMessageFromTarget", (event) => {
			if (event.sessionId === sessionId) {
				this.receive(JSON.parse(event.message));
			}
		});
	}

	/** 応答と非同期イベントを呼び出し元へ渡す。 */
	receive(message) {
		if (!message.id) {
			this.emit(message.method, message.params);
			return;
		}
		const request = this.pending.get(message.id);
		if (!request) {
			return;
		}
		clearTimeout(request.timer);
		this.pending.delete(message.id);
		if (message.error) {
			request.reject(new Error(JSON.stringify(message.error)));
		} else {
			request.resolve(message.result);
		}
	}

	/** CDP の要求を転送し、未応答のまま計測が止まらないように期限を設ける。 */
	async send(method, params = {}) {
		const id = ++this.nextId;
		const response = new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP timeout: ${method}`));
			}, 15000);
			this.pending.set(id, { resolve, reject, timer });
		});
		await this.browserSession.send("Target.sendMessageToTarget", {
			sessionId: this.sessionId,
			message: JSON.stringify({ id, method, params }),
		});
		return response;
	}
}

/** 表示用データは注入せず、実画面の DOM 操作と観測にだけ使う。 */
function chatContext(session, contextId) {
	return {
		async evaluate(callback, argument) {
			const result = await session.send("Runtime.evaluate", {
				expression: `(${callback.toString()})(${JSON.stringify(argument) ?? "undefined"})`,
				contextId,
				returnByValue: true,
				awaitPromise: true,
			});
			if (result.exceptionDetails) {
				throw new Error(JSON.stringify(result.exceptionDetails));
			}
			return result.result.value;
		},
	};
}

/** Webview の iframe と、その内部にあるチャットの実行コンテキストを特定する。 */
async function connectWebview(browserSession) {
	let target;
	await expect
		.poll(
			async () => {
				const { targetInfos } =
					await browserSession.send("Target.getTargets");
				target = targetInfos.find(
					(entry) =>
						entry.type === "iframe" &&
						entry.url.includes("extensionId=nerita-local.nerita"),
				);
				return Boolean(target);
			},
			{ timeout: 20000 },
		)
		.toBe(true);
	const { sessionId } = await browserSession.send("Target.attachToTarget", {
		targetId: target.targetId,
		flatten: false,
	});
	const frameSession = new FrameSession(browserSession, sessionId);
	const contexts = [];
	frameSession.on("Runtime.executionContextCreated", ({ context }) => {
		if (context.auxData?.isDefault) {
			contexts.push(context);
		}
	});
	await frameSession.send("Runtime.enable");
	let chat;
	await expect
		.poll(
			async () => {
				for (const context of contexts) {
					const candidate = chatContext(frameSession, context.id);
					if (
						await candidate.evaluate(() =>
							Boolean(
								globalThis.document.querySelector(
									'[aria-label="Codexへのメッセージ"]',
								),
							),
						)
					) {
						chat = candidate;
						return true;
					}
				}
				return false;
			},
			{ timeout: 20000 },
		)
		.toBe(true);
	return { chat, frameSession };
}

module.exports = { connectWebview };

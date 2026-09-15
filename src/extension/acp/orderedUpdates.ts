// SDKの通知キューより完了応答が先に処理されることを防ぐ。
import type { Stream, AnyMessage } from "@agentclientprotocol/sdk";

/** 先行するsession/updateのハンドラー完了まで、RPC応答の配送を待つ。 */
export function orderedUpdates(
	stream: Stream,
	consumeExtension: (params: unknown) => boolean = () => false,
) {
	const pending: (() => void)[] = [];
	let drained = Promise.resolve();
	const readable = stream.readable.pipeThrough(
		new TransformStream<AnyMessage, AnyMessage>({
			async transform(message, controller) {
				if (
					"method" in message &&
					message.method === "session/update" &&
					!("id" in message)
				) {
					// 拡張通知も先行する標準通知の後に処理し、未知の型をSDKへ渡さない。
					await drained;
					if (consumeExtension(message.params)) {
						return;
					}
					const finished = new Promise<void>((resolve) => {
						pending.push(resolve);
					});
					drained = Promise.all([drained, finished]).then(
						() => undefined,
					);
				} else if (!("method" in message)) {
					await drained;
				}
				controller.enqueue(message);
			},
		}),
	);
	return {
		stream: { ...stream, readable },
		handled: () => pending.shift()?.(),
		// 不正な通知でSDKがハンドラーを呼ばなかった場合も切断時に待ちを解放する。
		close: () => pending.splice(0).forEach((resolve) => resolve()),
	};
}

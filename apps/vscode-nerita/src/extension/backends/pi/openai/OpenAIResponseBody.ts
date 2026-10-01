// Host の補助 API は展開後の本文を制限し、秘密値を含む生応答を外へ出さない。
/** Content-Length がなくても受信上限で打ち切る。 */
export async function readOpenAIResponse(
	response: Response,
	signal: AbortSignal,
): Promise<unknown> {
	const reader = response.body?.getReader();
	if (!reader) {
		return null;
	}
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			signal.throwIfAborted();
			const { done, value } = (await reader.read()) as {
				done: boolean;
				value?: Uint8Array;
			};
			if (done) {
				break;
			}
			if (!value) {
				return null;
			}
			size += value.byteLength;
			if (size > 2 * 1024 * 1024) {
				return null;
			}
			chunks.push(value);
		}
		signal.throwIfAborted();
		return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
}

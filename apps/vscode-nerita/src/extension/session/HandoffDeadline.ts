// 要約生成の期限と呼び出し元の取消を1つの寿命にまとめる。
import type { HandoffGenerator, HandoffRequest } from "./HandoffContext";

/** 取消に応答しないプロバイダーでも、親への送信待ちは終了する。 */
export async function handoffWithDeadline(
	request: HandoffRequest,
	generate: HandoffGenerator,
) {
	const abort = new AbortController();
	const signal = AbortSignal.any([request.signal, abort.signal]);
	const timer = setTimeout(() => abort.abort(), request.timeoutMs);
	let rejectAbort: () => void = () => {};
	try {
		signal.throwIfAborted();
		const cancelled = new Promise<never>((_, reject) => {
			rejectAbort = () => reject(new Error("Handoff cancelled"));
			signal.addEventListener("abort", rejectAbort, { once: true });
		});
		const result = await Promise.race([
			generate({ ...request, signal }),
			cancelled,
		]);
		signal.throwIfAborted();
		if (!result.trim()) {
			throw new Error("Empty handoff");
		}
		return result;
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", rejectAbort);
	}
}

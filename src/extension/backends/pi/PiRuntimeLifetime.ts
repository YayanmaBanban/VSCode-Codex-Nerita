// SDK の同期 `dispose` を、子 Runtime・承認待ち・シェル接続の非同期回収へ結び付ける。
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiChildRuntimes } from "./PiChildRuntimes";

/** `close` は再入可能にし、`Controller` が回収完了を待てるようにする。 */
export function bindPiRuntimeLifetime(
	session: AgentSession,
	children: PiChildRuntimes,
	lifetime: AbortController,
	parentSignal: AbortSignal,
) {
	const abort = session.abort.bind(session);
	const dispose = session.dispose.bind(session);
	let closing: Promise<void> | undefined;
	/** 親 `Stop` は起動中の子も含めて伝播する。 */
	session.abort = async () => {
		await Promise.all([children.stop(), abort()]);
	};
	/** `signal` は先に失効させ、承認や接続が遅れて完了しても実行させない。 */
	const close = () => {
		if (!closing) {
			closing = Promise.resolve().then(async () => {
				try {
					await session.abort();
				} finally {
					children.dispose();
					dispose();
					parentSignal.removeEventListener("abort", onAbort);
				}
			});
			lifetime.abort();
		}
		return closing;
	};
	const onAbort = () => {
		void close().catch(() => undefined);
	};
	session.dispose = onAbort;
	parentSignal.addEventListener("abort", onAbort, { once: true });
	if (parentSignal.aborted) {
		onAbort();
	}
	return close;
}

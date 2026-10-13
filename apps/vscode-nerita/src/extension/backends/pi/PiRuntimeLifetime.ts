// SDK の同期 `dispose` を、子 Runtime・承認待ち・シェル接続の非同期回収へ結び付ける。
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiChildRuntimes } from "./PiChildRuntimes";
import { PiOutputArchiveError } from "./results/PiOutputArchive";

/** `close` の重複呼出しには同じ Promise を返し、呼び出し元が終了処理の完了を待てるようにする。 */
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
		const [childResult, parentResult] = await Promise.allSettled([
			children.stop(),
			abort(),
		]);
		if (childResult.status === "rejected") {
			throw childResult.reason;
		}
		if (parentResult.status === "rejected") {
			throw parentResult.reason;
		}
	};
	/** `signal` は先に失効させ、承認や接続が遅れて完了しても実行させない。 */
	const close = () => {
		if (!closing) {
			closing = Promise.resolve().then(async () => {
				try {
					await session.abort();
				} catch (error) {
					// 全 Runtime の停止が済んだ後の出力保存失敗だけは、終了未確認へ変換しない。
					if (!(error instanceof PiOutputArchiveError)) {
						throw error;
					}
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
	/** 実行管理の中断時に、接続と関連する資源の終了処理を開始する。 */
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

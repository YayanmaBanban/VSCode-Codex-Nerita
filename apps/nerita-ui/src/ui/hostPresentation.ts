// 画面ごとに注入された Host の表示情報を、子コンポーネントへ同じ context で渡す。
import { getContext } from "svelte";
import type { HostPresentation } from "@nerita/shared/hostPresentation";

// `mount` の `context` オプションと共有するため、キーを明示する。表示文言の既定値は UI に置かない。
export const hostPresentationKey = Symbol("hostPresentation");
/** コンポーネントの初期化中に呼び、接続し忘れを別の Host の文言で補完しない。 */
export function useHostPresentation(): HostPresentation {
	const presentation = getContext<HostPresentation | undefined>(
		hostPresentationKey,
	);
	if (!presentation) {
		throw new Error("Host の表示情報が接続されていません。");
	}
	return presentation;
}

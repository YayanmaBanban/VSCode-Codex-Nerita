// UI と Host のアダプターが共有する、実行環境に依存しない通信契約。
import type { HostMessage, UiMessage } from "./messages";

/** UI が要求を送り、Host の通知を購読するための契約。 */
export type Bridge = {
	postMessage: (message: UiMessage) => void;
	subscribe: (listener: (message: HostMessage) => void) => () => void;
};

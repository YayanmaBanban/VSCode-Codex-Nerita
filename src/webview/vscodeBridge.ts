// VS Code API を呼ぶ唯一のブラウザ境界。Storybook では同じ契約を差し替える。
import type { HostMessage, UiMessage } from "../shared/messages";
import { isHostMessage } from "../shared/hostMessageValidation";
import type { PiAuthRequest } from "../shared/piAuth";
/** UI から利用できる双方向通信の契約。 */
export type Bridge = {
	postMessage: (message: UiMessage) => void;
	subscribe: (listener: (message: HostMessage) => void) => () => void;
};
/** VS Code が Webview に提供する最小 API。 */
type VsCodeApi = { postMessage: (message: UiMessage | PiAuthRequest) => void };
declare function acquireVsCodeApi(): VsCodeApi;
let api: VsCodeApi | undefined;
/** 認証専用パネルではチャット状態の保存・復元を利用しない。 */
export function createPiAuthPost(): (request: PiAuthRequest) => void {
	api ??= acquireVsCodeApi();
	return (request) => api?.postMessage(request);
}
/** API を一度だけ取得し、購読解除可能な Bridge を返す。 */
export function createVsCodeBridge(): Bridge {
	api ??= acquireVsCodeApi();
	return {
		postMessage: (message) => api?.postMessage(message),
		subscribe(listener) {
			const receive = (event: MessageEvent<unknown>) => {
				if (isHostMessage(event.data)) {
					listener(event.data);
				}
			};
			window.addEventListener("message", receive);
			return () => window.removeEventListener("message", receive);
		},
	};
}

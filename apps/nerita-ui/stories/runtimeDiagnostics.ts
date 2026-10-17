// 描画開始から操作後のフレームまで、実行時の警告とエラーをストーリーの失敗として扱う。
import { expect, spyOn } from "storybook/test";

/** ストーリーのメタ情報に展開する監視処理を返す。ログは通常どおり出力し、ストーリーの切り替え時に監視を解除する。 */
export function runtimeDiagnostics() {
	const messages: string[] = [];
	return {
		beforeEach() {
			messages.length = 0;
			const originalWarn = console.warn;
			const originalError = console.error;
			const warn = spyOn(console, "warn").mockImplementation(
				(...args) => {
					messages.push(args.map(String).join(" "));
					originalWarn(...args);
				},
			);
			const error = spyOn(console, "error").mockImplementation(
				(...args) => {
					messages.push(args.map(String).join(" "));
					originalError(...args);
				},
			);
			const onError = (event: ErrorEvent) => messages.push(event.message);
			window.addEventListener("error", onError);
			return () => {
				warn.mockRestore();
				error.mockRestore();
				window.removeEventListener("error", onError);
			};
		},
		async afterEach() {
			// サイズ通知と、それに続く次フレームの処理も検証対象にする。
			await new Promise(requestAnimationFrame);
			await new Promise(requestAnimationFrame);
			await expect(messages).toEqual([]);
		},
	};
}

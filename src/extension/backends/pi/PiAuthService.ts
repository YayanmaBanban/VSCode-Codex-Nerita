// 認証専用エディターにSDKの対話を接続する。
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type { PiAuthService } from "./PiAccount";
import { isPiAuthRequest, type PiAuthState } from "../../../shared/piAuth";
import { webviewHtml } from "../../webview/webviewHtml";

/** パネルを閉じると処理・入力待ちを回収する接続専用サービス。 */
export function createPiAuthService(extensionUri: vscode.Uri): PiAuthService {
	let panel: vscode.WebviewPanel | undefined;
	let state: PiAuthState = {
		items: [],
		active: null,
		prompt: null,
		notice: "",
		error: null,
	};
	let answer: ((id: string, value: string) => void) | undefined;
	let feedbackOwner: string | undefined;
	const publish = () => {
		if (feedbackOwner) {
			state.feedback = {
				...state.feedback,
				[feedbackOwner]: { notice: state.notice, error: state.error },
			};
		}
		if (panel) {
			void panel.webview.postMessage(state);
		}
	};
	return {
		async manage(items, execute, signal) {
			feedbackOwner = undefined;
			state = {
				items: await items(),
				active: null,
				prompt: null,
				notice: "",
				error: null,
			};
			signal.throwIfAborted();
			panel = vscode.window.createWebviewPanel(
				"nerita.pi.auth",
				"Pi 認証情報",
				vscode.ViewColumn.Active,
				{
					enableScripts: true,
					retainContextWhenHidden: false,
					localResourceRoots: [
						vscode.Uri.joinPath(extensionUri, "dist", "webview"),
					],
				},
			);
			panel.webview.html = webviewHtml(
				panel.webview,
				extensionUri,
				"pi-auth",
			);
			const currentPanel = panel;
			let running: Promise<void> | undefined;
			let operation: AbortController | undefined;
			await new Promise<void>((resolve) => {
				const abort = () => {
					currentPanel.dispose();
				};
				signal.addEventListener("abort", abort, { once: true });
				const listener = currentPanel.webview.onDidReceiveMessage(
					(value: unknown) => {
						if (!isPiAuthRequest(value)) {
							return;
						}
						if (value.type === "ready") {
							publish();
							return;
						}
						if (value.type === "cancel") {
							operation?.abort();
							return;
						}
						if (value.type === "answer") {
							answer?.(value.id, value.value);
							return;
						}
						if (
							running ||
							!state.items.some((item) =>
								item.methods.some(
									(method) => method.id === value.id,
								),
							)
						) {
							return;
						}
						operation = new AbortController();
						feedbackOwner = state.items.find((item) =>
							item.methods.some(
								(method) => method.id === value.id,
							),
						)!.id;
						const combined = AbortSignal.any([
							signal,
							operation.signal,
							AbortSignal.timeout(180_000),
						]);
						state = {
							...state,
							active: value.id,
							error: null,
							notice: "認証処理中…",
						};
						publish();
						running = execute(value.id, combined)
							.then(async () => {
								state.items = await items();
								state.notice = "認証情報を更新しました。";
							})
							.catch(() => {
								state.error = combined.aborted
									? "認証をキャンセルしました。"
									: "認証できませんでした。入力内容を確認して再試行してください。";
								state.notice = "";
							})
							.finally(() => {
								// 完了した認証のブラウザ応答が次の認証先へ混入するのを防ぐ。
								operation?.abort();
								state.active = null;
								state.prompt = null;
								answer = undefined;
								running = undefined;
								publish();
							});
					},
				);
				currentPanel.onDidDispose(() => {
					operation?.abort();
					panel = undefined;
					answer = undefined;
					signal.removeEventListener("abort", abort);
					listener.dispose();
					void Promise.resolve(running).finally(resolve);
				});
			});
		},
		interaction(signal) {
			return {
				signal,
				prompt(prompt) {
					const combined = prompt.signal
						? AbortSignal.any([signal, prompt.signal])
						: signal;
					combined.throwIfAborted();
					const id = randomUUID();
					state.prompt = {
						id,
						message: prompt.message,
						secret:
							prompt.type === "secret" ||
							prompt.type === "manual_code",
						...(prompt.type === "select"
							? {
									options: prompt.options.map((item) => ({
										id: item.id,
										label: item.label,
									})),
								}
							: {}),
					};
					publish();
					return new Promise<string>((resolve, reject) => {
						const clean = () => {
							combined.removeEventListener("abort", abort);
							if (state.prompt?.id === id) {
								state.prompt = null;
								answer = undefined;
								publish();
							}
						};
						const abort = () => {
							clean();
							reject(new Error("認証をキャンセルしました。"));
						};
						combined.addEventListener("abort", abort, {
							once: true,
						});
						answer = (requestId, value) => {
							if (
								requestId !== id ||
								(prompt.type === "select" &&
									!prompt.options.some(
										(option) => option.id === value,
									))
							) {
								return;
							}
							clean();
							resolve(value);
						};
					});
				},
				notify(event) {
					if (signal.aborted) {
						return;
					}
					const url =
						event.type === "auth_url"
							? event.url
							: event.type === "device_code"
								? event.verificationUri
								: undefined;
					state.notice =
						event.type === "device_code"
							? `認証コード: ${event.userCode}`
							: event.type === "auth_url"
								? (event.instructions ??
									"ブラウザで認証を完了してください。")
								: event.message;
					if (url) {
						try {
							if (new URL(url).protocol === "https:") {
								void vscode.env
									.openExternal(vscode.Uri.parse(url))
									.then(
										(opened) => {
											if (!opened && !signal.aborted) {
												state.error =
													"認証ページを開けませんでした。";
												publish();
											}
										},
										() => {
											if (!signal.aborted) {
												state.error =
													"認証ページを開けませんでした。";
												publish();
											}
										},
									);
							} else {
								state.error =
									"認証URLはHTTPSである必要があります。";
							}
						} catch {
							state.error = "認証URLを開けませんでした。";
						}
					}
					publish();
				},
			};
		},
	};
}

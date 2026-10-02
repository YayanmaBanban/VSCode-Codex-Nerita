// 認証専用エディターに SDK の対話を接続する。

import { isPiAuthRequest, type PiAuthState } from "@nerita/shared/piAuth";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { webviewHtml } from "../../webview/webviewHtml";
import type { PiAuthService } from "./PiAccount";

/** 認証パネルを閉じると、進行中の認証を中断して入力待ちを解除するサービス。 */
export function createPiAuthService(extensionUri: vscode.Uri): PiAuthService {
	return new PiAuthPanel(extensionUri);
}

/** 認証の完了とパネルの破棄が同じ実行状態を参照する。 */
type AuthPanelRun = {
	panel: vscode.WebviewPanel;
	items: Parameters<PiAuthService["manage"]>[0];
	execute: Parameters<PiAuthService["manage"]>[1];
	signal: AbortSignal;
	running?: Promise<void> | undefined;
	operation?: AbortController;
};

/** 認証パネルが開いている間だけ SDK の入力待ちを受け付け、閉じたら中断する。 */
class PiAuthPanel implements PiAuthService {
	private panel: vscode.WebviewPanel | undefined;
	private state: PiAuthState = {
		items: [],
		active: null,
		prompt: null,
		notice: "",
		error: null,
	};
	private answer: ((id: string, value: string) => void) | undefined;
	private feedbackOwner: string | undefined;
	constructor(private readonly extensionUri: vscode.Uri) {}

	/** 通知を認証先に紐付け、他の認証先の結果を上書きしない。 */
	private publish() {
		if (this.feedbackOwner) {
			this.state.feedback = {
				...this.state.feedback,
				[this.feedbackOwner]: {
					notice: this.state.notice,
					error: this.state.error,
				},
			};
		}
		if (this.panel) {
			void this.panel.webview.postMessage(this.state);
		}
	}

	/** パネルが閉じられるまで待ち、進行中の認証を中断して終了を待ってから返す。 */
	async manage(
		items: AuthPanelRun["items"],
		execute: AuthPanelRun["execute"],
		signal: AbortSignal,
	) {
		this.feedbackOwner = undefined;
		this.state = {
			items: await items(),
			active: null,
			prompt: null,
			notice: "",
			error: null,
		};
		signal.throwIfAborted();
		this.panel = vscode.window.createWebviewPanel(
			"nerita.pi.auth",
			"Pi 認証情報",
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: false,
				localResourceRoots: [
					vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
				],
			},
		);
		this.panel.webview.html = webviewHtml(
			this.panel.webview,
			this.extensionUri,
			"pi-auth",
		);
		await this.waitForPanel({ panel: this.panel, items, execute, signal });
	}

	/** 破棄時に購読と入力待ちを解除し、実行の終了を待つ。 */
	private waitForPanel(run: AuthPanelRun) {
		return new Promise<void>((resolve) => {
			const abort = () => {
				run.panel.dispose();
			};
			run.signal.addEventListener("abort", abort, { once: true });
			const listener = run.panel.webview.onDidReceiveMessage(
				(value: unknown) => this.handleRequest(value, run),
			);
			run.panel.onDidDispose(() => {
				run.operation?.abort();
				this.panel = undefined;
				this.answer = undefined;
				run.signal.removeEventListener("abort", abort);
				listener.dispose();
				void Promise.resolve(run.running).finally(resolve);
			});
		});
	}

	/** Webview の要求を検証してから認証操作へ接続する。 */
	private handleRequest(value: unknown, run: AuthPanelRun) {
		if (!isPiAuthRequest(value)) {
			return;
		}
		if (value.type === "ready") {
			this.publish();
			return;
		}
		if (value.type === "cancel") {
			run.operation?.abort();
			return;
		}
		if (value.type === "answer") {
			this.answer?.(value.id, value.value);
			return;
		}
		const provider = this.state.items.find((item) =>
			item.methods.some((method) => method.id === value.id),
		);
		if (run.running || !provider) {
			return;
		}
		run.operation = new AbortController();
		this.feedbackOwner = provider.id;
		const combined = AbortSignal.any([
			run.signal,
			run.operation.signal,
			AbortSignal.timeout(180000),
		]);
		this.state = {
			...this.state,
			active: value.id,
			error: null,
			notice: "認証処理中…",
		};
		this.publish();
		run.running = run
			.execute(value.id, combined)
			.then(async () => {
				this.state.items = await run.items();
				this.state.notice = "認証情報を更新しました。";
			})
			.catch(() => {
				this.state.error = combined.aborted
					? "認証をキャンセルしました。"
					: "認証できませんでした。入力内容を確認して再試行してください。";
				this.state.notice = "";
			})
			.finally(() => {
				// 完了した認証のブラウザ応答が次の認証先へ混入するのを防ぐ。
				run.operation?.abort();
				this.state.active = null;
				this.state.prompt = null;
				this.answer = undefined;
				run.running = undefined;
				this.publish();
			});
	}

	/** SDK の対話がサービスの共有状態を参照するように接続する。 */
	interaction(signal: AbortSignal): ReturnType<PiAuthService["interaction"]> {
		return {
			signal,
			prompt: (prompt) => this.prompt(signal, prompt),
			notify: (event) => this.notify(signal, event),
		};
	}

	/** 選択値を検証し、入力待ちの終了時に中断購読も解除する。 */
	private prompt(
		signal: AbortSignal,
		prompt: Parameters<
			ReturnType<PiAuthService["interaction"]>["prompt"]
		>[0],
	) {
		const combined = prompt.signal
			? AbortSignal.any([signal, prompt.signal])
			: signal;
		combined.throwIfAborted();
		const id = randomUUID();
		this.state.prompt = {
			id,
			message: prompt.message,
			secret: prompt.type === "secret" || prompt.type === "manual_code",
			...(prompt.type === "select"
				? {
						options: prompt.options.map((item) => ({
							id: item.id,
							label: item.label,
						})),
					}
				: {}),
		};
		this.publish();
		return new Promise<string>((resolve, reject) => {
			const clean = () => {
				combined.removeEventListener("abort", abort);
				if (this.state.prompt?.id === id) {
					this.state.prompt = null;
					this.answer = undefined;
					this.publish();
				}
			};
			const abort = () => {
				clean();
				reject(new Error("認証をキャンセルしました。"));
			};
			combined.addEventListener("abort", abort, { once: true });
			this.answer = (requestId, value) => {
				if (requestId !== id || !validPromptAnswer(prompt, value)) {
					return;
				}
				clean();
				resolve(value);
			};
		});
	}

	/** 認証の進行通知を反映し、HTTPS の認証先だけを開く。 */
	private notify(
		signal: AbortSignal,
		event: Parameters<
			ReturnType<PiAuthService["interaction"]>["notify"]
		>[0],
	) {
		if (signal.aborted) {
			return;
		}
		let url: string | undefined;
		if (event.type === "auth_url") {
			url = event.url;
			this.state.notice =
				event.instructions ?? "ブラウザで認証を完了してください。";
		} else if (event.type === "device_code") {
			url = event.verificationUri;
			this.state.notice = `認証コード: ${event.userCode}`;
		} else {
			this.state.notice = event.message;
		}
		if (url) {
			this.openAuthUrl(signal, url);
		}
		this.publish();
	}

	/** 遅れて届くブラウザ応答で終了済みの認証を更新しない。 */
	private openAuthUrl(signal: AbortSignal, url: string) {
		try {
			if (new URL(url).protocol !== "https:") {
				this.state.error = "認証URLはHTTPSである必要があります。";
				return;
			}
			const failed = () => {
				if (!signal.aborted) {
					this.state.error = "認証ページを開けませんでした。";
					this.publish();
				}
			};
			void vscode.env
				.openExternal(vscode.Uri.parse(url))
				.then((opened) => {
					if (!opened) {
						failed();
					}
				}, failed);
		} catch {
			this.state.error = "認証URLを開けませんでした。";
		}
	}
}

/** 選択式の認証では、提示されていない値を受け付けない。 */
function validPromptAnswer(
	prompt: Parameters<ReturnType<PiAuthService["interaction"]>["prompt"]>[0],
	value: string,
) {
	return (
		prompt.type !== "select" ||
		prompt.options.some((option) => option.id === value)
	);
}

// 文書更新を直列化し、パネルごとの実行・停止・破棄を管理する。
import { errorText } from "@nerita/shared/errorText";
import * as vscode from "vscode";
import type { BackendSession } from "../../../session/chatSession";
import { parseWorkflow } from "@nerita/shared/workflows/definition";
import { compileWorkflow } from "./compiler";
import {
	workflowRequestSchema,
	type WorkflowRequest,
	type WorkflowReply,
} from "@nerita/shared/workflows/messages";
import { workflowDocument } from "./WorkflowDocument";
/** 版を照合して直列更新し、長い実行でも停止要求を先に処理する。 */
export class WorkflowPanel {
	private queue = Promise.resolve();
	private abort: AbortController | undefined;
	private disposed = false;
	private stopped = 0;
	/** 表示する文書と実行先をこのパネルへ固定し、受信した操作の対象確認に使う。 */
	constructor(
		private document: vscode.TextDocument,
		private panel: vscode.WebviewPanel,
		private backend: BackendSession,
	) {}
	/** 画面の破棄後に遅い結果を配信しない。 */
	post(message: WorkflowReply) {
		if (!this.disposed) {
			void this.panel.webview.postMessage(message);
		}
	}
	/** 保存前の編集バッファ・文書の版・実行状態を一緒に公開し、保存済み文書とは区別する。 */
	publish() {
		this.post({
			type: "state",
			text: this.document.getText(),
			version: this.document.version,
			dirty: this.document.isDirty,
			file: vscode.workspace.asRelativePath(this.document.uri),
			running: !!this.abort,
		});
	}
	/** 停止世代を進めて待機中の開始要求を失効させ、現在の実行にも取消しを伝える。 */
	stop() {
		this.stopped++;
		this.abort?.abort();
	}
	/** パネルの破棄時は、受付済みで未起動の要求も無効化する。 */
	close() {
		this.disposed = true;
		this.stop();
	}
	/** 要求を検証して直列化し、停止は待機列を待たずに処理する。操作失敗も画面へ返信する。 */
	receive(value: unknown) {
		if (this.disposed) {
			return;
		}
		const parsed = workflowRequestSchema.safeParse(value);
		if (!parsed.success) {
			return;
		}
		const message = parsed.data;
		if (message.type === "stop") {
			this.stop();
			return;
		}
		if (message.type === "chat") {
			void vscode.commands.executeCommand("nerita.codex.chat.focus");
			return;
		}
		const stopVersion = this.stopped;
		this.queue = this.queue.then(async () => {
			try {
				await this.handle(message, stopVersion);
			} catch (error) {
				this.post({
					type: "reply",
					id: "id" in message ? message.id : 0,
					error: errorText(error),
					notice: "",
				});
			}
			this.publish();
		});
	}
	/** 実行中の定義は固定し、保存と検証は開いている文書そのものを対象にする。 */
	private async handle(
		message: Exclude<WorkflowRequest, { type: "stop" | "chat" }>,
		stopVersion: number,
	) {
		if (message.type === "ready") {
			return;
		}
		const target = await workflowDocument(this.document.uri);
		this.assertCurrent(message, stopVersion);
		let notice = "";
		let script: string | undefined;
		if (message.type === "edit") {
			const edit = new vscode.WorkspaceEdit();
			edit.replace(
				this.document.uri,
				new vscode.Range(0, 0, this.document.lineCount, 0),
				message.text,
			);
			const matchesValue = !(await vscode.workspace.applyEdit(edit));
			if (matchesValue) {
				throw new Error("文書を更新できませんでした。");
			}
		} else if (message.type === "save") {
			const matchesValue2 = !(await this.document.save());
			if (matchesValue2) {
				throw new Error("保存できませんでした。");
			}
			notice = "保存しました。";
		} else {
			script = compileWorkflow(parseWorkflow(this.document.getText()));
			if (message.type === "run") {
				if (this.document.isDirty) {
					throw new Error("実行前に保存してください。");
				}
				this.start(target, this.document.getText());
				notice =
					"実行を開始しました。承認と進捗は AgentViewer で確認できます。";
			} else {
				notice =
					"TOML と依存関係を検証しました。Agent と Pi の検証は実行開始時に行います。";
			}
		}
		this.publish();
		this.post({
			type: "reply",
			id: message.id,
			error: null,
			notice,
			script,
		});
	}
	/** 文書とパネルの状態を確認して、古い要求を拒否する。 */
	private assertCurrent(
		message: Extract<WorkflowRequest, { id: number }>,
		stopVersion: number,
	) {
		const matchesDisposed =
			this.disposed ||
			(message.type === "run" && stopVersion !== this.stopped);
		if (matchesDisposed) {
			throw new Error("実行を停止しました。");
		}
		if (message.version !== this.document.version) {
			throw new Error(
				"別の編集が反映されました。再読み込みしてください。",
			);
		}
		if (this.abort) {
			throw new Error("実行が終了してから編集してください。");
		}
	}
	/** 結果を待つ間も文書通知と個別停止を受け付ける。 */
	private start(target: { root: string; file: string }, text: string) {
		if (!this.backend.workflow) {
			throw new Error("Pi バックエンドへ接続してください。");
		}
		const abort = new AbortController();
		this.abort = abort;
		void vscode.commands.executeCommand("nerita.codex.chat.focus");
		void this.backend
			.workflow({ ...target, text }, abort.signal)
			.then(
				() =>
					this.post({
						type: "reply",
						id: 0,
						error: null,
						notice: "実行が完了しました。結果は AgentViewer で確認できます。",
					}),
				(error: unknown) =>
					this.post({
						type: "reply",
						id: 0,
						error: abort.signal.aborted ? null : errorText(error),
						notice: abort.signal.aborted
							? "実行を停止しました。"
							: "",
					}),
			)
			.finally(() => {
				this.abort = undefined;
				this.publish();
			});
	}
}

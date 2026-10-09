// バックエンドの内部実行を完了通知へ結び付ける。Webview の購読や状態監視で完了を判定しない。
import type { ChatMessage, ToolSummary } from "@nerita/shared/chatState";
import type { ComposerReference } from "@nerita/shared/composerReferences";
import type { SessionContextReference } from "@nerita/shared/sessionReferences";
import type { ChangeScope } from "@nerita/shared/changeReferences";
import type { CodeReference } from "@nerita/shared/codeReferences";

/** 通常入力と内部実行が共用する送信データ。UI メッセージの種類や受信経路は持たない。 */
export type BackendPrompt = {
	requestId: string;
	text: string;
	references?: ComposerReference[];
	sessionReferences?: SessionContextReference[];
	changeScopes?: ChangeScope[];
	codeReferences?: CodeReference[];
};
export type BackendExecutionResult = {
	outcome: "completed" | "failed" | "cancelled";
	response: string | null;
	tools: ToolSummary[];
};

/** ツールを表示用の省略・参照へ変換する前の観測を保持する。 */
export class BackendExecution {
	private pending:
		| {
				resolve: (value: BackendExecutionResult) => void;
				reject: (error: Error) => void;
		  }
		| undefined;
	private messages: ChatMessage[] = [];
	private tools: ToolSummary[] = [];
	begin(): Promise<BackendExecutionResult> {
		if (this.pending) {
			throw new Error("内部実行は既に開始しています。");
		}
		this.messages = [];
		this.tools = [];
		return new Promise((resolve, reject) => {
			this.pending = { resolve, reject };
		});
	}
	observe(change: { messages?: ChatMessage[]; tools?: ToolSummary[] }): void {
		if (!this.pending) {
			return;
		}
		if (change.messages) {
			this.messages = structuredClone(change.messages);
		}
		if (change.tools) {
			this.tools = structuredClone(change.tools);
		}
	}
	/** SDK またはターンの正式な完了経路だけが呼ぶ。 */
	finish(outcome: BackendExecutionResult["outcome"]): void {
		const pending = this.pending;
		this.pending = undefined;
		pending?.resolve({
			outcome,
			response:
				this.messages
					.filter((message) => message.role === "assistant")
					.at(-1)?.text ?? null,
			tools: this.tools,
		});
	}
	fail(error: Error): void {
		const pending = this.pending;
		this.pending = undefined;
		pending?.reject(error);
	}
}

/** 停止はバックエンドに伝え、実際の終了通知まで待ってから根拠を返す。 */
export async function executeBackend(
	execution: BackendExecution,
	start: () => void | Promise<void>,
	cancel: () => void,
	signal: AbortSignal,
): Promise<BackendExecutionResult> {
	signal.throwIfAborted();
	const result = execution.begin();
	void result.catch(() => {});
	const stopped = () => cancel();
	signal.addEventListener("abort", stopped, { once: true });
	try {
		try {
			await start();
		} catch (error) {
			execution.fail(
				error instanceof Error
					? error
					: new Error("内部実行を開始できません。"),
			);
		}
		return await result;
	} finally {
		signal.removeEventListener("abort", stopped);
	}
}

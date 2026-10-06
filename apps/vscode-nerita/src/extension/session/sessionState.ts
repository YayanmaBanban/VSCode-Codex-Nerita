// Host が管理する会話状態と UI 購読を保持し、単調に増加する番号付きの差分を配信する。
import { nonEmptyString } from "@nerita/shared/valuePredicates";
import { initialState, type ChatState } from "@nerita/shared/chatState";
import { type HostMessage } from "@nerita/shared/messages";
import { createBuiltinUiRegistry } from "../ui-contributions/builtinContributions";
import type { ContributionContext } from "../ui-contributions/contributionConditions";
import { StatePublisher } from "./statePublisher";
import { ToolOutputStore } from "./ToolOutputStore";
import type { ToolOutputRequest } from "@nerita/shared/toolOutput";
/** 接続と実行が共有する状態・承認管理。 */
export class SessionState {
	private outputs = new ToolOutputStore();
	/** 出力取得は実行状態から独立させ、失効した参照も通常の応答として返す。 */
	protected async readToolOutput(request: ToolOutputRequest): Promise<void> {
		this.emit(await this.outputs.read(request));
	}
	protected state = initialState();
	protected readonly uiRegistry = createBuiltinUiRegistry();
	/** Pi は SDK セッションの現在のプロバイダーに合わせて、このメソッドを上書きする。 */
	protected contributionContext(): ContributionContext {
		return {
			backend: "codex",
			provider: "openai-codex",
			capabilities: this.state.configOptions.map((item) => item.id),
		};
	}
	private listeners = new Set<(event: HostMessage) => void>();
	private publisher = new StatePublisher((event) => {
		for (const listener of this.listeners) {
			listener(event);
		}
	});
	/** 呼び出し側で変更しても Host 内の会話状態に影響しないスナップショットを返す。 */
	snapshot(): ChatState {
		this.publisher.flush();
		return structuredClone({
			...this.state,
			uiContributions: this.uiRegistry.resolve(
				this.state,
				this.contributionContext(),
			),
		});
	}
	/** UI 通知の購読と解除を提供する。 */
	subscribe(listener: (event: HostMessage) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/** 全購読先へ通知する。 */
	protected emit(event: HostMessage, outputs?: ToolOutputStore): void {
		if (event.type === "agent/view") {
			if (outputs) {
				this.outputs.adopt(event.view.threadId, outputs);
			}
			event = {
				...event,
				view: {
					...event.view,
					tools: event.view.tools.map((tool) =>
						this.outputs.project(tool),
					),
				},
			};
		}
		this.publisher.publish(event);
	}
	/** Host 内の会話状態を更新して番号付きの差分を配信する。 */
	protected patch(
		patch: Partial<Omit<ChatState, "revision">>,
		outputs?: ToolOutputStore,
	): void {
		patch = finalizeMessages(patch, this.state);
		// 一覧の絞り込みや再取得で現在のタイトルを失わないよう、会話状態に保持する。
		const sessionId =
			patch.sessionId === undefined
				? this.state.sessionId
				: patch.sessionId;
		const row = patch.sessions?.find(
			(item) => item.sessionId === sessionId,
		);
		if (sessionId !== this.state.sessionId || outputs) {
			this.outputs.dispose();
		}
		if (outputs) {
			this.outputs = outputs;
		}
		if (patch.tools) {
			patch = {
				...patch,
				tools: patch.tools.map((tool) => this.outputs.project(tool)),
			};
		}
		patch = {
			...(sessionId !== this.state.sessionId ? { agents: [] } : {}),
			...patch,
			sessionTitle: sessionTitle(patch, row, sessionId, this.state),
		};
		this.state = {
			...this.state,
			...patch,
			revision: this.state.revision + 1,
		};
		const contributions = this.uiRegistry.resolve(
			this.state,
			this.contributionContext(),
		);
		if (
			JSON.stringify(contributions) !==
			JSON.stringify(this.state.uiContributions)
		) {
			this.state.uiContributions = contributions;
			patch.uiContributions = contributions;
		}
		this.emit({
			type: "state/patch",
			revision: this.state.revision,
			patch,
		});
	}
	/** 実行と停止待ちをまとめて排他判定する。 */
	protected busy(): boolean {
		return this.state.run === "running" || this.state.run === "cancelling";
	}
	/** 終了時に UI 購読を解放する。 */
	protected clearListeners(): void {
		this.outputs.dispose();
		this.publisher.dispose();
		this.listeners.clear();
	}
}

/** 停止・失敗で完了通知が届かなくても、受信済みの本文を失わない。 */
function finalizeMessages(
	patch: Partial<ChatState>,
	state: ChatState,
): Partial<ChatState> {
	if (
		!(patch.run !== undefined) ||
		!["completed", "cancelled", "failed"].includes(patch.run)
	) {
		return patch;
	}
	return {
		...patch,
		messages: (patch.messages ?? state.messages).map((message) =>
			message.streaming === true
				? { ...message, streaming: false }
				: message,
		),
	};
}

/** 明示タイトルと一覧を優先し、同じ会話では既存タイトルを保持する。 */
function sessionTitle(
	patch: Partial<ChatState>,
	row: ChatState["sessions"][number] | undefined,
	sessionId: ChatState["sessionId"],
	state: ChatState,
) {
	if (patch.sessionTitle !== undefined) {
		return patch.sessionTitle;
	}
	if (row) {
		return nonEmptyString(row.title?.trim()) ?? null;
	}
	if (sessionId !== state.sessionId) {
		return null;
	}
	return state.sessionTitle;
}

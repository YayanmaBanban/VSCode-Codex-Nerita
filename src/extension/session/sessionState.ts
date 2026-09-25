// 会話の正本と UI 購読を保持し、単調に増加する番号付きの差分を配信する。
import { initialState, type ChatState } from "../../shared/chatState";
import { type HostMessage } from "../../shared/messages";
import { createBuiltinUiRegistry } from "../ui-contributions/builtinContributions";
import type { ContributionContext } from "../ui-contributions/contributionConditions";
import { StatePublisher } from "./statePublisher";
/** 接続と実行が共有する状態・承認管理。 */
export class SessionState {
	protected state = initialState();
	protected readonly uiRegistry = createBuiltinUiRegistry();
	/** Pi は実 SDK の現在のプロバイダーで上書きする。 */
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
	/** 外部から正本を変更できないスナップショットを返す。 */
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
	protected emit(event: HostMessage): void {
		this.publisher.publish(event);
	}
	/** 正本を更新して番号付きの差分を配信する。 */
	protected patch(patch: Partial<Omit<ChatState, "revision">>): void {
		// 一覧の絞り込みや再取得で現在のタイトルを失わないよう、正本に保持する。
		const sessionId =
			patch.sessionId === undefined
				? this.state.sessionId
				: patch.sessionId;
		const row = patch.sessions?.find(
			(item) => item.sessionId === sessionId,
		);
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
		this.publisher.dispose();
		this.listeners.clear();
	}
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
		return row.title?.trim() || null;
	}
	if (sessionId !== state.sessionId) {
		return null;
	}
	return state.sessionTitle;
}

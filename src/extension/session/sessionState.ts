// 会話の正本とUI購読を保持し、単調増加番号付き差分を配信する。
import { initialState, type ChatState } from "../../shared/chatState";
import { type HostMessage } from "../../shared/messages";
import { createBuiltinUiRegistry } from "../ui-contributions/builtinContributions";
import type { ContributionContext } from "../ui-contributions/contributionConditions";
/** 接続と実行が共有する状態・承認管理。 */
export class SessionState {
	protected state = initialState();
	protected readonly uiRegistry = createBuiltinUiRegistry();
	/** Piは実SDKの現在のproviderで上書きする。 */
	protected contributionContext(): ContributionContext {
		return {
			backend: "codex",
			provider: "openai-codex",
			capabilities: this.state.configOptions.map((item) => item.id),
		};
	}
	private listeners = new Set<(event: HostMessage) => void>();
	/** 外部から正本を変更できないスナップショットを返す。 */
	snapshot(): ChatState {
		return structuredClone({
			...this.state,
			uiContributions: this.uiRegistry.resolve(
				this.state,
				this.contributionContext(),
			),
		});
	}
	/** UI通知の購読と解除を提供する。 */
	subscribe(listener: (event: HostMessage) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/** 全購読先へ通知する。 */
	protected emit(event: HostMessage): void {
		for (const listener of this.listeners) {
			listener(event);
		}
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
			sessionTitle:
				patch.sessionTitle !== undefined
					? patch.sessionTitle
					: row
						? row.title?.trim() || null
						: sessionId !== this.state.sessionId
							? null
							: this.state.sessionTitle,
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
	/** 終了時にUI購読を解放する。 */
	protected clearListeners(): void {
		this.listeners.clear();
	}
}

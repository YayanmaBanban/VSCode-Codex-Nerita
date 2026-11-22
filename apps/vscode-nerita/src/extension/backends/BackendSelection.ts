// バックエンドの設定保存と再生成を PC・リモートで直列化する。
import type { BackendId } from "@nerita/shared/backend";
import type { ChatState } from "@nerita/shared/chatState";
import type { BackendRuntime } from "../session/BackendRuntime";
import { configuredBackend, saveBackend } from "../webview/backendSettings";

/** 設定保存から新しいチャットへの接続まで単一の切替として扱う。 */
export class BackendSelection {
	private listeners = new Set<() => void>();
	private pending = false;
	private readonly chat;

	/** 通常チャットを共通の対象とし、DLC 表示と分ける。 */
	constructor(private readonly runtime: BackendRuntime) {
		this.chat = runtime.scope("chat");
	}

	/** 実際に生成された世代を使い、保存途中の設定と旧会話を混ぜない。 */
	current() {
		return {
			backend: this.runtime.chatBackend() ?? configuredBackend(),
			generation: this.runtime.chatGeneration(),
			switching: this.pending,
		};
	}

	/** 現在の処理を止めずに切替できるかを判定する。 */
	busy(state: ChatState) {
		const connecting =
			state.connection === "connecting" ||
			state.connection === "authenticating";
		const configuring =
			state.sessionPending ||
			state.configPending ||
			state.attachmentPending;
		const reviewing =
			state.permissions.length > 0 ||
			state.questions.length > 0 ||
			state.planDecision !== null;
		const pending = this.pending || this.runtime.busy();
		const processing = connecting || configuring || reviewing;
		return pending || processing;
	}

	/** 切替の開始と終了をチャット購読者に伝える。 */
	subscribe(listener: () => void) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** 設定保存中も通常チャットの操作を止めて、PC とモバイルで同じ排他を使う。 */
	async select(
		backend: BackendId,
		expected?: { backend: BackendId; generation: number },
	) {
		const current = this.current();
		const stale =
			expected !== undefined &&
			(expected.backend !== current.backend ||
				expected.generation !== current.generation);
		if (stale) {
			return "stale" as const;
		}
		if (this.busy(this.chat.snapshot()) || this.runtime.chatChanging()) {
			return "busy" as const;
		}
		if (backend === current.backend && backend === configuredBackend()) {
			return "ok" as const;
		}
		this.pending = true;
		try {
			return await this.runtime.withChatReplacement(async () => {
				this.publish();
				try {
					await saveBackend(backend);
					await this.runtime.restart();
					return this.chat.snapshot().connection === "error"
						? ("unavailable" as const)
						: ("ok" as const);
				} catch {
					return "unavailable" as const;
				}
			});
		} finally {
			this.pending = false;
			this.publish();
		}
	}

	/** 選択処理の開始・終了を購読者に通知する。 */
	private publish() {
		for (const listener of this.listeners) {
			listener();
		}
	}
}

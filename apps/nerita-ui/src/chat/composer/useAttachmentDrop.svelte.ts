// ファイルドロップと画像ペーストを、会話を固定した添付要求へ変換する。
import { onDestroy } from "svelte";
/** 外部へ登録したコールバックから最新値を参照するための可変の参照先。 */
type Reference<T> = { current: T };
/** 直接指定した値と、前の状態から計算する更新処理を共通に扱う。 */
type SetStateAction<T> = T | ((previous: T) => T);
/** 状態の更新要求を受け取る通知関数。呼び出し元は戻り値を利用しない。 */
type Dispatch<T> = (value: T) => void;
import {
	isNonEmptyString,
	isNonZeroNumber,
} from "@nerita/shared/valuePredicates";

import type { ChatState } from "@nerita/shared/chatState";

import type { UiMessage } from "@nerita/shared/messages";

import { readDroppedAttachments } from "./readDroppedAttachments";

/** 文字列だけの通常ドラッグを、添付操作から区別する。 */
function hasFiles(transfer: DataTransfer): boolean {
	return transfer.types.some((type) =>
		["files", "text/uri-list", "codefiles"].includes(type.toLowerCase()),
	);
}
/** 添付の表示状態を入力欄に限定し、読む途中の会話変更を検出する。 */
export function useAttachmentDrop(input: {
	state: ChatState;
	locked: boolean;
	send: (message: UiMessage) => void;
}) {
	return new AttachmentDrop(input);
}

/** 添付の読み取りを会話の寿命に結び付け、会話変更や入力欄の破棄後の結果を送信しない。 */
class AttachmentDrop {
	private readonly input: {
		state: ChatState;
		locked: boolean;
		send: (message: UiMessage) => void;
	};
	private activeState = $state(false);
	reading = $state(false);
	error = $state("");
	private readonly pending = { current: false };
	private readonly depth = { current: 0 };
	private disposed = false;
	/** 入力欄の破棄後は、読み取り中の添付を送信しない。 */
	constructor(input: {
		state: ChatState;
		locked: boolean;
		send: (message: UiMessage) => void;
	}) {
		this.input = input;
		onDestroy(() => {
			this.disposed = true;
		});
	}
	/** 操作できる会話のドラッグだけを強調表示する。 */
	get active() {
		return this.activeState && this.enabled;
	}
	/** 読み取り開始時と同じ会話・作業フォルダーか判定する識別子。 */
	private get scope() {
		const state = this.input.state;
		return `${state.connection}:${state.cwd}:${state.sessionId}`;
	}
	/** 接続・実行・添付の準備が揃う時だけ追加を許可する。 */
	private get enabled() {
		const { state, locked } = this.input;
		const connected =
			!locked &&
			state.connection === "ready" &&
			isNonEmptyString(state.sessionId);
		const idle = connected && !state.sessionPending && !state.configPending;
		const ready =
			idle && !state.attachmentPending && state.attachmentsSupported;
		const idleRun = state.run !== "running" && state.run !== "cancelling";
		return !this.disposed && ready && idleRun;
	}
	/** ファイルの読み取り中は入力と送信を固定する。 */
	private readonly setReading = (value: SetStateAction<boolean>) => {
		this.reading =
			typeof value === "function" ? value(this.reading) : value;
	};
	/** 同じ会話で起きた添付失敗だけを表示する。 */
	private readonly setError = (value: SetStateAction<string>) => {
		this.error = typeof value === "function" ? value(this.error) : value;
	};
	/** 入れ子のドラッグイベントから表示状態を更新する。 */
	private readonly setActive = (value: SetStateAction<boolean>) => {
		this.activeState =
			typeof value === "function" ? value(this.activeState) : value;
	};
	/** ブラウザーや Lexical がファイルを挿入する前に処理する。 */
	private readonly stop = (event: DragEvent | ClipboardEvent) => {
		event.preventDefault();
		event.stopPropagation();
	};
	/** 会話を固定して読み、処理後に現在の会話と照合する。 */
	private attach(transfer: DataTransfer) {
		return createAttachmentReader(
			this.enabled,
			this.pending,
			this.setReading,
			this.setError,
			() => ({ scope: this.scope, enabled: this.enabled }),
			this.scope,
			this.input.send,
			this.input.state,
		)(transfer);
	}
	/** イベント発生時の利用条件を使って操作を組み立てる。 */
	private get currentHandlers() {
		return attachmentDropHandlers(
			this.stop,
			(transfer) => this.attach(transfer),
			this.depth,
			this.setActive,
			this.enabled,
			this.pending,
		);
	}
	readonly handlers = {
		onPasteCapture: (event: ClipboardEvent) =>
			this.currentHandlers.onPasteCapture(event),
		onDragEnterCapture: (event: DragEvent) =>
			this.currentHandlers.onDragEnterCapture(event),
		onDragOverCapture: (event: DragEvent) =>
			this.currentHandlers.onDragOverCapture(event),
		onDragLeaveCapture: (event: DragEvent) =>
			this.currentHandlers.onDragLeaveCapture(event),
		onDropCapture: (event: DragEvent) =>
			this.currentHandlers.onDropCapture(event),
	};
}

/** ドラッグの入れ子を数え、ドロップと画像ペーストを同じ添付処理へ渡す。 */
function attachmentDropHandlers(
	stop: (event: DragEvent | ClipboardEvent) => void,
	attach: (transfer: DataTransfer) => Promise<void>,
	depth: Reference<number>,
	setActive: Dispatch<SetStateAction<boolean>>,
	enabled: boolean,
	pending: Reference<boolean>,
) {
	return {
		onPasteCapture(event: ClipboardEvent) {
			const images = Array.from(event.clipboardData?.files ?? []).filter(
				(file) => file.type.startsWith("image/"),
			);
			if (images.length === 0) {
				return;
			}
			stop(event);
			// コピー元の URL や HTML ではなく、クリップボード内の画像実体を添付する。
			const transfer = new DataTransfer();
			for (const file of images) {
				transfer.items.add(file);
			}
			void attach(transfer);
		},
		onDragEnterCapture(event: DragEvent) {
			if (!event.dataTransfer || !hasFiles(event.dataTransfer)) {
				return;
			}
			stop(event);
			depth.current++;
			setActive(true);
		},
		onDragOverCapture(event: DragEvent) {
			if (!event.dataTransfer || !hasFiles(event.dataTransfer)) {
				return;
			}
			stop(event);
			event.dataTransfer.dropEffect =
				enabled && !pending.current ? "copy" : "none";
		},
		onDragLeaveCapture(event: DragEvent) {
			if (!event.dataTransfer || !hasFiles(event.dataTransfer)) {
				return;
			}
			stop(event);
			depth.current = Math.max(0, depth.current - 1);
			if (!isNonZeroNumber(depth.current)) {
				setActive(false);
			}
		},
		async onDropCapture(event: DragEvent) {
			if (!event.dataTransfer || !hasFiles(event.dataTransfer)) {
				return;
			}
			stop(event);
			depth.current = 0;
			setActive(false);
			await attach(event.dataTransfer);
		},
	};
}

/** 読み取り中に会話が切り替わった場合は添付要求を送らない。 */
function createAttachmentReader(
	enabled: boolean,
	pending: Reference<boolean>,
	setReading: Dispatch<SetStateAction<boolean>>,
	setError: Dispatch<SetStateAction<string>>,
	current: () => { scope: string; enabled: boolean },
	scope: string,
	send: (message: UiMessage) => void,
	state: ChatState,
) {
	return async (transfer: DataTransfer) => {
		if (!enabled || pending.current) {
			return;
		}

		pending.current = true;
		setReading(true);
		setError("");
		try {
			const dropped = await readDroppedAttachments(transfer);

			// 読み取り中に会話や接続が変わった場合は、別の会話へ添付しない。
			if (current().scope === scope && current().enabled) {
				send({
					type: "attachment/add",
					requestId: crypto.randomUUID(),
					sessionId: state.sessionId!,
					files: dropped,
				});
			}
		} catch (cause) {
			if (current().scope === scope) {
				setError(
					cause instanceof Error
						? cause.message
						: "添付できませんでした。",
				);
			}
		} finally {
			pending.current = false;
			setReading(false);
		}
	};
}

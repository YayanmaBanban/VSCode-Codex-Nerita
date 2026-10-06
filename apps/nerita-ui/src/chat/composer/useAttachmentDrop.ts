// ファイルドロップと画像ペーストを、会話を固定した添付要求へ変換する。
import {
	isNonEmptyString,
	isNonZeroNumber,
} from "@nerita/shared/valuePredicates";

import type { ChatState } from "@nerita/shared/chatState";
import type { UiMessage } from "@nerita/shared/messages";
import {
	useLayoutEffect,
	useRef,
	useState,
	type ClipboardEvent,
	type Dispatch,
	type DragEvent,
	type RefObject,
	type SetStateAction,
} from "react";
import { readDroppedAttachments } from "./readDroppedAttachments";

/** 文字列だけの通常ドラッグを、添付操作から区別する。 */
function hasFiles(transfer: DataTransfer): boolean {
	return transfer.types.some((type) =>
		["files", "text/uri-list", "codefiles"].includes(type.toLowerCase()),
	);
}

/** 添付ボタンと同じ利用条件を適用し、読み込み中に会話が切り替わった場合は添付しない。 */
export function useAttachmentDrop(
	state: ChatState,
	locked: boolean,
	send: (message: UiMessage) => void,
) {
	const [active, setActive] = useState(false);
	const [error, setError] = useState("");
	const [reading, setReading] = useState(false);
	const pending = useRef(false);
	const depth = useRef(0);
	const enabled =
		!locked &&
		state.connection === "ready" &&
		!!isNonEmptyString(state.sessionId) &&
		!state.sessionPending &&
		!state.configPending &&
		!state.attachmentPending &&
		state.attachmentsSupported &&
		state.run !== "running" &&
		state.run !== "cancelling";
	const scope = `${state.connection}:${state.cwd}:${state.sessionId}`;
	const current = useRef({ scope, enabled });
	useLayoutEffect(() => {
		current.current = { scope, enabled };
	}, [scope, enabled]);

	/** 子要素の Lexical やブラウザーがファイルを挿入・表示する前に処理する。 */
	const stop = (event: DragEvent | ClipboardEvent) => {
		event.preventDefault();
		event.stopPropagation();
	};

	/** ドロップとペーストの読み込み・会話確認を共通化する。 */
	const attach = (transfer: DataTransfer) =>
		createAttachmentReader(
			enabled,
			pending,
			setReading,
			setError,
			current,
			scope,
			send,
			state,
		)(transfer);

	/** イベント発生時にだけドラッグ深度と読み込み状態を参照する。 */
	const handlers = () =>
		attachmentDropHandlers(
			stop,
			attach,
			depth,
			setActive,
			enabled,
			pending,
		);
	return {
		active: active && enabled,
		reading,
		error,
		handlers: {
			onPasteCapture: (event: ClipboardEvent) =>
				handlers().onPasteCapture(event),
			onDragEnterCapture: (event: DragEvent) =>
				handlers().onDragEnterCapture(event),
			onDragOverCapture: (event: DragEvent) =>
				handlers().onDragOverCapture(event),
			onDragLeaveCapture: (event: DragEvent) =>
				handlers().onDragLeaveCapture(event),
			onDropCapture: (event: DragEvent) =>
				handlers().onDropCapture(event),
		},
	};
}

/** ドラッグの入れ子を数え、ドロップと画像ペーストを同じ添付処理へ渡す。 */
function attachmentDropHandlers(
	stop: (event: DragEvent | ClipboardEvent) => void,
	attach: (transfer: DataTransfer) => Promise<void>,
	depth: RefObject<number>,
	setActive: Dispatch<SetStateAction<boolean>>,
	enabled: boolean,
	pending: RefObject<boolean>,
) {
	return {
		onPasteCapture(event: ClipboardEvent) {
			const images = Array.from(event.clipboardData.files).filter(
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
			if (!hasFiles(event.dataTransfer)) {
				return;
			}
			stop(event);
			depth.current++;
			setActive(true);
		},
		onDragOverCapture(event: DragEvent) {
			if (!hasFiles(event.dataTransfer)) {
				return;
			}
			stop(event);
			event.dataTransfer.dropEffect =
				enabled && !pending.current ? "copy" : "none";
		},
		onDragLeaveCapture(event: DragEvent) {
			if (!hasFiles(event.dataTransfer)) {
				return;
			}
			stop(event);
			depth.current = Math.max(0, depth.current - 1);
			if (!isNonZeroNumber(depth.current)) {
				setActive(false);
			}
		},
		async onDropCapture(event: DragEvent) {
			if (!hasFiles(event.dataTransfer)) {
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
	pending: RefObject<boolean>,
	setReading: Dispatch<SetStateAction<boolean>>,
	setError: Dispatch<SetStateAction<string>>,
	current: RefObject<{ scope: string; enabled: boolean }>,
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
			if (current.current.scope === scope && current.current.enabled) {
				send({
					type: "attachment/add",
					requestId: crypto.randomUUID(),
					sessionId: state.sessionId!,
					files: dropped,
				});
			}
		} catch (cause) {
			if (current.current.scope === scope) {
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

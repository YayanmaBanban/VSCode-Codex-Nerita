// ファイルドロップと画像ペーストを、会話を固定した添付要求へ変換する。
import { useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import type { ChatState } from "../../../shared/chatState";
import type { UiMessage } from "../../../shared/messages";
import { readDroppedAttachments } from "./readDroppedAttachments";

/** 文字列だけの通常ドラッグを、添付操作から区別する。 */
function hasFiles(transfer: DataTransfer): boolean {
	return transfer.types.some((type) =>
		["files", "text/uri-list", "codefiles"].includes(type.toLowerCase()),
	);
}

/** 添付ボタンと同じ利用条件を適用し、非同期読み込み中の会話切り替えを排除する。 */
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
		!!state.sessionId &&
		!state.sessionPending &&
		!state.configPending &&
		!state.attachmentPending &&
		state.attachmentsSupported &&
		state.run !== "running" &&
		state.run !== "cancelling";
	const scope = `${state.connection}:${state.cwd}:${state.sessionId}`;
	const current = useRef({ scope, enabled });
	current.current = { scope, enabled };

	/** 子要素の Lexical やブラウザーがファイルを挿入・表示する前に処理する。 */
	const stop = (event: DragEvent | ClipboardEvent) => {
		event.preventDefault();
		event.stopPropagation();
	};

	/** ドロップとペーストの読み込み・会話確認を共通化する。 */
	const attach = async (transfer: DataTransfer) => {
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

	return {
		active: active && enabled,
		reading,
		error,
		handlers: {
			onPasteCapture(event: ClipboardEvent) {
				const images = Array.from(event.clipboardData.files).filter(
					(file) => file.type.startsWith("image/"),
				);
				if (!images.length) {
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
				if (!depth.current) {
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
		},
	};
}

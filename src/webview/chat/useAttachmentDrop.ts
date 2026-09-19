// 入力欄へのファイルドロップを読み込み、会話を固定した添付要求へ変換する。
import { useRef, useState, type DragEvent } from "react";
import type { ChatState, UiMessage } from "../../shared/messages";
import {
	MAX_DROP_BYTES,
	isLocalFileUri,
	type DroppedAttachment,
} from "../../shared/attachmentDrop";

/** 文字列だけの通常ドラッグを、添付操作から区別する。 */
function hasFiles(transfer: DataTransfer): boolean {
	return transfer.types.some((type) =>
		["files", "text/uri-list", "codefiles"].includes(type.toLowerCase()),
	);
}
/** ファイル内容をJSONで送れるBase64へ変換する。 */
function readFile(file: File): Promise<DroppedAttachment> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () =>
			reject(new Error("ファイルを読み込めませんでした。"));
		reader.onload = () =>
			resolve({
				name: file.name,
				data: (reader.result as string).split(",")[1] ?? "",
			});
		reader.readAsDataURL(file);
	});
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
	/** 子要素のLexicalやブラウザーがファイルを挿入・表示する前に処理する。 */
	const stop = (event: DragEvent) => {
		event.preventDefault();
		event.stopPropagation();
	};
	return {
		active: active && enabled,
		reading,
		error,
		handlers: {
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
				if (!enabled || pending.current) {
					return;
				}
				pending.current = true;
				setReading(true);
				setError("");
				try {
					if (
						Array.from(event.dataTransfer.items).some(
							(item) => item.webkitGetAsEntry?.()?.isDirectory,
						)
					) {
						throw new Error("フォルダーは添付できません。");
					}
					let uris = event.dataTransfer
						.getData("text/uri-list")
						.split(/\r?\n/)
						.map((uri) => uri.trim())
						.filter(isLocalFileUri);
					// VS Codeのエクスプローラーが渡すローカル絶対パスも参照として扱う。
					const codeFiles = event.dataTransfer.getData("CodeFiles");
					if (!uris.length && codeFiles) {
						const paths: unknown = JSON.parse(codeFiles);
						if (Array.isArray(paths)) {
							uris = paths
								.filter(
									(path): path is string =>
										typeof path === "string",
								)
								.filter((path) =>
									/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(path),
								)
								.map((path) => {
									const normalized = path.replaceAll(
										"\\",
										"/",
									);
									return `file:${normalized.startsWith("//") ? "" : normalized.startsWith("/") ? "//" : "///"}${normalized
										.split("/")
										.map(encodeURIComponent)
										.join("/")
										.replace(/^([a-z])%3A/i, "$1:")}`;
								})
								.filter(isLocalFileUri);
						}
					}
					const files = Array.from(event.dataTransfer.files);
					if (
						Math.max(uris.length, files.length) > 20 ||
						files.reduce((sum, file) => sum + file.size, 0) >
							MAX_DROP_BYTES
					) {
						throw new Error(
							"一度に添付できるのは20ファイル、内容の転送は合計20MBまでです。",
						);
					}
					const dropped = uris.length
						? uris.map((uri) => ({ uri }))
						: await Promise.all(files.map(readFile));
					if (!dropped.length) {
						throw new Error(
							"ローカルファイルをドロップしてください。",
						);
					}
					if (
						current.current.scope === scope &&
						current.current.enabled
					) {
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
			},
		},
	};
}

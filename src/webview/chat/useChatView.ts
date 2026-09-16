// サイドバーとエディタの下書き・スクロール位置をHost経由で引き継ぐ。
import { useEffect, useRef, useState } from "react";
import type { Bridge } from "../vscodeBridge";

/** 表示先ごとのDOMと、全表示先で共有する下書きを接続する。 */
export function useChatView(bridge: Bridge) {
	const [draft, updateDraft] = useState("");
	const [editor, setEditor] = useState(false);
	const [restore, setRestore] = useState<{ scrollTop: number } | null>(null);
	const conversation = useRef<HTMLElement>(null);
	useEffect(
		() =>
			bridge.subscribe((message) => {
				if (message.type !== "ui/viewState") {
					return;
				}
				updateDraft(message.draft);
				setEditor(message.editor);
				if (message.restoreScroll) {
					setRestore({ scrollTop: message.scrollTop });
				}
			}),
		[bridge],
	);
	useEffect(() => {
		if (!restore) {
			return;
		}
		// スナップショットの描画と通常の末尾追従を終えてから移動前の位置に戻す。
		const frame = requestAnimationFrame(() => {
			if (conversation.current) {
				conversation.current.scrollTop = restore.scrollTop;
			}
		});
		return () => cancelAnimationFrame(frame);
	}, [restore]);
	/** ローカル入力を即座に反映し、隠れた表示先にも最新値を渡す。 */
	const setDraft = (value: string) => {
		updateDraft(value);
		bridge.postMessage({
			type: "ui/saveDraft",
			requestId: crypto.randomUUID(),
			draft: value,
		});
	};
	/** 移動直前の位置を保存してから、Hostに表示先の切り替えを依頼する。 */
	const toggleEditor = () => {
		bridge.postMessage({
			type: "ui/saveScroll",
			requestId: crypto.randomUUID(),
			scrollTop: conversation.current?.scrollTop ?? 0,
		});
		bridge.postMessage({
			type: editor ? "ui/openSidebar" : "ui/openEditor",
			requestId: crypto.randomUUID(),
		});
	};
	return { draft, setDraft, editor, toggleEditor, conversation };
}

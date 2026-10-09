// サイドバーとエディタの配置・スクロール位置を Host 経由で引き継ぐ。

import {
	type EffectCallback,
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useEffect,
	useRef,
	useState,
} from "react";

import type { BackendId } from "@nerita/shared/backend";
import type { Bridge } from "@nerita/shared/bridge";
import type { SidebarLocation } from "@nerita/shared/sidebar";
import type { ConversationScrollAnchor } from "@nerita/shared/conversationScroll";

/** 表示先の変更後に復元する位置。 */
export type ConversationRestore = {
	scrollTop: number;
	scrollAnchor?: ConversationScrollAnchor;
};

/** 表示先ごとの DOM と、接続・配置・スクロール位置を接続する。 */
export function useChatView(bridge: Bridge) {
	const [untrusted, setUntrusted] = useState(false);
	const [backend, setBackend] = useState<BackendId | undefined>();
	const [editor, setEditor] = useState(false);
	const [sidebarLocation, setSidebarLocation] =
		useState<SidebarLocation>("secondary");
	const [restore, setRestore] = useState<ConversationRestore | null>(null);
	const scrollAnchor = useRef<() => ConversationScrollAnchor | undefined>(
		() => undefined,
	);
	const conversation = useRef<HTMLElement>(null);
	useEffect(
		() =>
			createViewStateEffect(
				bridge,
				setBackend,
				setUntrusted,
				setSidebarLocation,
				setEditor,
				setRestore,
			)(),
		[bridge],
	);
	/** 移動直前の位置を保存してから、Host に表示先の切り替えを依頼する。 */
	const toggleEditor = () => {
		saveScroll(bridge, conversation, scrollAnchor);
		bridge.postMessage({
			type: editor ? "ui/openSidebar" : "ui/openEditor",
			requestId: crypto.randomUUID(),
		});
	};
	/** 配置変更にも移動直前のスクロール位置を引き継ぐ。 */
	const selectSidebar = (location: SidebarLocation) =>
		createSidebarSelector(
			sidebarLocation,
			bridge,
			conversation,
			scrollAnchor,
		)(location);
	return {
		untrusted,
		backend,
		editor,
		toggleEditor,
		conversation,
		sidebarLocation,
		selectSidebar,
		restore,
		scrollAnchor,
	};
}

/** 表示先の配置とスクロール位置を購読し、下書きの更新は入力領域へ任せる。 */
function createViewStateEffect(
	bridge: Bridge,
	setBackend: Dispatch<SetStateAction<BackendId | undefined>>,
	setUntrusted: Dispatch<SetStateAction<boolean>>,
	setSidebarLocation: Dispatch<SetStateAction<SidebarLocation>>,
	setEditor: Dispatch<SetStateAction<boolean>>,
	setRestore: Dispatch<SetStateAction<ConversationRestore | null>>,
): EffectCallback {
	return () =>
		bridge.subscribe((message) => {
			if (message.type === "workspace/trustState") {
				setUntrusted(message.untrusted);
				return;
			}
			if (message.type === "ui/backendState") {
				setBackend(message.backend);
				return;
			}
			if (message.type === "ui/sidebarState") {
				setSidebarLocation(message.location);
				return;
			}
			if (message.type !== "ui/viewState") {
				return;
			}
			setEditor(message.editor);
			if (message.restoreScroll) {
				setRestore({
					scrollTop: message.scrollTop,
					...(message.scrollAnchor
						? { scrollAnchor: message.scrollAnchor }
						: {}),
				});
			}
		});
}

/** 表示先の移動前にスクロール位置を保存する。 */
function createSidebarSelector(
	sidebarLocation: SidebarLocation,
	bridge: Bridge,
	conversation: RefObject<HTMLElement | null>,
	scrollAnchor: RefObject<() => ConversationScrollAnchor | undefined>,
) {
	return (location: SidebarLocation) => {
		if (location === sidebarLocation) {
			return;
		}
		saveScroll(bridge, conversation, scrollAnchor);
		bridge.postMessage({
			type: "ui/setSidebar",
			requestId: crypto.randomUUID(),
			location,
		});
	};
}

/** 現在の行位置を一度だけ採取し、どの表示先への移動でも同じ形式で保存する。 */
function saveScroll(
	bridge: Bridge,
	conversation: RefObject<HTMLElement | null>,
	anchorRef: RefObject<() => ConversationScrollAnchor | undefined>,
) {
	const scrollAnchor = anchorRef.current();
	bridge.postMessage({
		type: "ui/saveScroll",
		requestId: crypto.randomUUID(),
		scrollTop: conversation.current?.scrollTop ?? 0,
		...(scrollAnchor ? { scrollAnchor } : {}),
	});
}

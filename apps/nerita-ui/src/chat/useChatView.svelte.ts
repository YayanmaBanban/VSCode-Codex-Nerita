// 表示先ごとの DOM と、Host が保存する配置・復元位置を接続する。
import type { BackendId } from "@nerita/shared/backend";
import type { Bridge } from "@nerita/shared/bridge";
import type { HostMessage } from "@nerita/shared/messages";
import type { SidebarLocation } from "@nerita/shared/sidebar";
import type { ConversationScrollAnchor } from "@nerita/shared/conversationScroll";

/** 表示先の変更後に復元する位置。 */
export type ConversationRestore = {
	scrollTop: number;
	scrollAnchor?: ConversationScrollAnchor;
};

/** 会話の内容と下書きを所有せず、表示位置と外部配置だけを購読する。 */
export function useChatView(getBridge: () => Bridge) {
	return new ChatViewController(getBridge);
}

/** チャットの表示状態と復元位置を保持し、接続の交換や画面の破棄で旧通知を失効させる。 */
class ChatViewController {
	untrusted = $state(false);
	backend = $state<BackendId | undefined>();
	editor = $state(false);
	sidebarLocation = $state<SidebarLocation>("secondary");
	restore = $state.raw<ConversationRestore | null>(null);
	conversation = $state.raw<HTMLElement | null>(null);
	bottom = $state.raw<HTMLDivElement | null>(null);
	/** 仮想リストの行位置を、保存直前に採取する。 */
	scrollAnchor: () => ConversationScrollAnchor | undefined = () => undefined;
	private readonly getBridge: () => Bridge;

	/** 各画面の寿命で表示通知を購読し、破棄時に解除する。 */
	constructor(getBridge: () => Bridge) {
		this.getBridge = getBridge;
		// Bridge の交換と画面の破棄に合わせ、表示状態の購読を張り替えて旧通知を失効させる。
		$effect(() => this.connect());
	}

	/** 古い Bridge の通知を失効させ、新しい接続だけを購読する。 */
	private connect() {
		const bridge = this.getBridge();
		let active = true;
		const unsubscribe = bridge.subscribe((message) => {
			if (active) {
				this.receive(message);
			}
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}

	/** 確定した表示情報を種別ごとに受信する。 */
	private receive(message: HostMessage) {
		if (message.type === "workspace/trustState") {
			this.untrusted = message.untrusted;
		} else if (message.type === "ui/backendState") {
			this.backend = message.backend;
		} else if (message.type === "ui/sidebarState") {
			this.sidebarLocation = message.location;
		} else if (message.type === "ui/viewState") {
			this.editor = message.editor;
			if (message.restoreScroll) {
				this.restore = {
					scrollTop: message.scrollTop,
					...(message.scrollAnchor
						? { scrollAnchor: message.scrollAnchor }
						: {}),
				};
			}
		}
	}

	/** 現在の行位置を採取して、移動前に Host へ保存する。 */
	private saveScroll() {
		const anchor = this.scrollAnchor();
		this.getBridge().postMessage({
			type: "ui/saveScroll",
			requestId: crypto.randomUUID(),
			scrollTop: this.conversation?.scrollTop ?? 0,
			...(anchor ? { scrollAnchor: anchor } : {}),
		});
	}

	/** 移動直前の位置を保存して表示先を切り替える。 */
	toggleEditor = () => {
		this.saveScroll();
		this.getBridge().postMessage({
			type: this.editor ? "ui/openSidebar" : "ui/openEditor",
			requestId: crypto.randomUUID(),
		});
	};

	/** サイドバーの配置変更にも現在位置を引き継ぐ。 */
	selectSidebar = (location: SidebarLocation) => {
		if (location === this.sidebarLocation) {
			return;
		}
		this.saveScroll();
		this.getBridge().postMessage({
			type: "ui/setSidebar",
			requestId: crypto.randomUUID(),
			location,
		});
	};
}

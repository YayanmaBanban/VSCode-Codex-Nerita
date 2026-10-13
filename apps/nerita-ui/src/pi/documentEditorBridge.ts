// 文書エディターの購読と編集待機を管理し、破棄した接続からの応答を受け付けない。

/** 保存・検査・実行の意味は各エディターに残し、購読の寿命だけを共有する。 */
type DocumentSubscription<Reply> = {
	subscribe: (receive: (reply: Reply) => void) => () => void;
	postMessage: (request: { type: "ready" }) => void;
};

/** ready 前に受信先を登録し、接続の世代と編集待機を同じ寿命で管理する。 */
export class DocumentEditorBridge<Reply> {
	private generation = 0;
	private release: (() => void) | undefined;
	private timer: number | undefined;
	private readonly bridge: DocumentSubscription<Reply>;
	private readonly receive: (reply: Reply) => void;

	/** 応答先を画面の所有者へ固定し、再描画による購読の再作成を避ける。 */
	constructor(
		bridge: DocumentSubscription<Reply>,
		receive: (reply: Reply) => void,
	) {
		this.bridge = bridge;
		this.receive = receive;
	}

	/** 描画状態ではなく、破棄後の編集要求を防ぐために接続の有無を読む。 */
	get connected() {
		return this.release !== undefined;
	}

	/** 旧接続を閉じてから登録し、解除済み listener の遅延通知を世代で除外する。 */
	connect() {
		this.release?.();
		const generation = ++this.generation;
		const unsubscribe = this.bridge.subscribe((reply) => {
			if (this.generation === generation) {
				this.receive(reply);
			}
		});
		const release = () => {
			if (this.generation !== generation) {
				return;
			}
			this.generation++;
			this.cancelEdit();
			this.release = undefined;
			unsubscribe();
		};
		this.release = release;
		this.bridge.postMessage({ type: "ready" });
		return release;
	}

	/** 最後の入力から待機し、接続が閉じた場合は送信処理を実行しない。 */
	scheduleEdit(send: () => void) {
		this.cancelEdit();
		if (!this.connected) {
			return;
		}
		const generation = this.generation;
		this.timer = window.setTimeout(() => {
			if (this.generation !== generation) {
				return;
			}
			this.timer = undefined;
			if (this.connected) {
				send();
			}
		}, 150);
	}

	/** 古い入力の待機を解除し、接続破棄時にも未送信の編集を残さない。 */
	cancelEdit() {
		if (this.timer !== undefined) {
			window.clearTimeout(this.timer);
			this.timer = undefined;
		}
	}
}

/** Host の文書と UI の未送信入力。変更は Svelte のアクセサーを通して反映する。 */
type DocumentDraft<State> = { state: State | null; text: string };

/** 更新前の Host 文書と下書きを照合し、編集中の下書きを残したまま最新の Host 文書を受け取る。 */
export function applyDocumentSnapshot<State extends { text: string }>(
	draft: DocumentDraft<State>,
	snapshot: State,
	pending: { edit: boolean } | null,
) {
	const local = draft.state !== null && draft.text !== draft.state.text;
	draft.state = snapshot;
	if (pending?.edit !== true && !local) {
		draft.text = snapshot.text;
	}
	return pending === null && local;
}

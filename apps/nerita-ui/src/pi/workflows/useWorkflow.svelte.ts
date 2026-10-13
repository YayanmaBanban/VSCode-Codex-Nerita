// 実行中の定義を固定し、Host の文書更新と未送信の下書きを照合する。
import { onMount } from "svelte";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import {
	DocumentEditorBridge,
	applyDocumentSnapshot,
} from "../documentEditorBridge";
import type {
	WorkflowBridge,
	WorkflowReply,
	WorkflowState,
} from "@nerita/shared/workflows/messages";
/** 文書版と保留要求を画面インスタンス内で管理する。 */
class WorkflowEditorState {
	state = $state.raw<WorkflowState | null>(null);
	text = $state("");
	reply = $state.raw<Extract<WorkflowReply, { type: "reply" }> | null>(null);
	private active = $state(false);
	private pending: { id: number; edit: boolean; text?: string } | null = null;
	private sequence = 0;
	private readonly connection: DocumentEditorBridge<WorkflowReply>;
	/** 画面で使う通信境界を固定し、再描画による再購読を避ける。 */
	private readonly bridge: WorkflowBridge;
	/** この画面の要求と応答を、同じ Host の通信境界へ接続する。 */
	constructor(bridge: WorkflowBridge) {
		this.bridge = bridge;
		this.connection = new DocumentEditorBridge(bridge, this.receive);
	}
	/** Host への反映待ちを含め、未同期の文書を保存できないようにする。 */
	get busy() {
		return this.active || this.text !== this.state?.text;
	}
	/** 編集要求の待機中は入力を許し、保存や実行の待機中は固定する。 */
	get locked() {
		return (
			(this.active && this.pending?.edit === false) ||
			this.state?.running === true
		);
	}
	/** 保存・実行の成功は Host の応答で確定する。 */
	connect = () => this.connection.connect();
	/** 上限内の下書きを保持し、確定応答の後に最新版を送る。 */
	change = (value: string) => {
		if (value.length > 262144) {
			return;
		}
		this.text = value;
		this.reply = null;
		this.scheduleEdit();
	};
	/** 同期した文書の版を添え、結果は Host の応答まで待つ。 */
	request = (type: "save" | "check" | "run") => {
		if (!this.state || this.busy) {
			return;
		}
		const id = ++this.sequence;
		this.pending = { id, edit: false };
		this.active = true;
		this.reply = null;
		this.bridge.postMessage({ type, id, version: this.state.version });
	};
	/** 明示した破棄操作でだけ未送信の下書きを Host の文書へ戻す。 */
	reload = () => {
		if (!this.state) {
			return;
		}
		this.text = this.state.text;
		this.reply = null;
		this.scheduleEdit();
	};
	/** 成功した編集の改行正規化は、新しい入力がない場合だけ反映する。 */
	private receive = (message: WorkflowReply) => {
		if (message.type === "state") {
			this.receiveState(message);
		} else if (message.id === 0) {
			this.reply = message;
		} else if (this.pending?.id === message.id) {
			if (this.pending.edit && !isNonEmptyString(message.error)) {
				this.acceptEdit();
			}
			if (!this.pending.edit || isNonEmptyString(message.error)) {
				this.reply = message;
			}
			this.pending = null;
			this.active = false;
		}
		this.scheduleEdit();
	};
	/** 入力の有無を更新前の文書と照合し、外部更新で下書きを消さない。 */
	private receiveState(message: WorkflowState) {
		if (applyDocumentSnapshot(this, message, this.pending)) {
			this.reply = {
				type: "reply",
				id: 0,
				error: "入力中に文書が更新されました。再読み込みするか、編集内容を確認してください。",
				notice: "",
			};
		}
	}
	/** 定義の実行中と競合時は編集を送らず、150 ms 後に入力を反映する。 */
	private scheduleEdit() {
		this.connection.cancelEdit();
		if (!this.connection.connected || !this.state || this.active) {
			return;
		}
		const blocked =
			this.text === this.state.text ||
			this.state.running ||
			isNonEmptyString(this.reply?.error);
		if (blocked) {
			return;
		}
		this.connection.scheduleEdit(this.sendEdit);
	}
	/** 待機後の最新状態を再検査し、実行中や破棄後には送らない。 */
	private sendEdit = () => {
		if (!this.state || this.active) {
			return;
		}
		if (this.state.running) {
			return;
		}
		const id = ++this.sequence;
		this.pending = { id, edit: true, text: this.text };
		this.active = true;
		this.bridge.postMessage({
			type: "edit",
			id,
			version: this.state.version,
			text: this.text,
		});
	};
	/** 破棄した画面や古い入力から編集要求を送らないよう待機を解除する。 */
	/** 成功した要求より後の入力を保持し、未送信入力がない場合だけ正規化を反映する。 */
	private acceptEdit() {
		if (this.text === this.pending?.text && this.state) {
			this.text = this.state.text;
		}
	}
}
/** Getter を描画時に読み取り、画面破棄時に購読と未送信タイマーを解除する。 */
export function useWorkflow(bridge: WorkflowBridge) {
	const editor = new WorkflowEditorState(bridge);
	onMount(() => editor.connect());
	return editor;
}

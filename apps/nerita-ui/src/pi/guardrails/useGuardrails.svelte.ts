// 入力中の下書きを保持し、Host の文書版と要求番号で編集・保存を直列化する。
import { onMount } from "svelte";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import {
	DocumentEditorBridge,
	applyDocumentSnapshot,
} from "../documentEditorBridge";
import type {
	GuardBridge,
	GuardProbe,
	GuardReply,
	GuardState,
} from "@nerita/shared/guardrails/messages";
/** 画面インスタンスごとの未保存入力と要求状態。Host の文書を正本とする。 */
class GuardrailsEditorState {
	state = $state.raw<GuardState | null>(null);
	text = $state("");
	reply = $state.raw<Extract<GuardReply, { type: "reply" }> | null>(null);
	private active = $state(false);
	private pending: { id: number; edit: boolean } | null = null;
	private sequence = 0;
	private readonly connection: DocumentEditorBridge<GuardReply>;
	/** 画面で使う通信境界を固定し、再描画による再購読を避ける。 */
	private readonly bridge: GuardBridge;
	/** この画面の要求と応答を、同じ Host の通信境界へ接続する。 */
	constructor(bridge: GuardBridge) {
		this.bridge = bridge;
		this.connection = new DocumentEditorBridge(bridge, this.receive);
	}
	/** Host への反映待ちを含め、未同期の文書を保存できないようにする。 */
	get busy() {
		return this.active || this.text !== this.state?.text;
	}
	/** 編集要求の待機中は入力を許し、保存や実行の待機中は固定する。 */
	get locked() {
		return this.active && this.pending?.edit === false;
	}
	/** Host 更新と未送信の入力が競合した場合に破棄操作を提示する。 */
	get conflict() {
		return Boolean(this.reply?.error) && this.text !== this.state?.text;
	}
	/** 購読を ready より先に登録し、再描画では再初期化しない。 */
	connect = () => this.connection.connect();
	/** 編集応答の待機中にも新しい入力を保持し、次の版へ順に送る。 */
	/** 上限内の下書きを保持し、確定応答の後に最新版を送る。 */
	change = (value: string) => {
		if (value.length > 131072) {
			this.reply = {
				type: "reply",
				id: 0,
				error: "設定は128 Ki文字以内にしてください。",
				notice: "",
				result: null,
				warnings: [],
			};
			this.connection.cancelEdit();
			return;
		}
		this.text = value;
		this.reply = null;
		this.scheduleEdit();
	};
	/** 同期した文書の版を添え、結果は Host の応答まで待つ。 */
	request = (type: "save" | "apply" | "check", probe: GuardProbe) => {
		if (!this.state || this.busy) {
			return;
		}
		const id = ++this.sequence;
		this.pending = { id, edit: false };
		this.active = true;
		this.reply = null;
		this.bridge.postMessage(
			type === "check"
				? { type, id, version: this.state.version, probe }
				: { type, id, version: this.state.version },
		);
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
	/** 操作対象が変わった通知では未送信の入力を上書きしない。 */
	private receive = (message: GuardReply) => {
		if (message.type === "state") {
			this.receiveState(message);
		} else if (this.pending?.id === message.id) {
			if (!this.pending.edit || isNonEmptyString(message.error)) {
				this.reply = message;
			}
			this.pending = null;
			this.active = false;
		}
		this.scheduleEdit();
	};
	/** 入力の有無を更新前の文書と照合し、外部更新で下書きを消さない。 */
	private receiveState(message: GuardState) {
		if (applyDocumentSnapshot(this, message, this.pending)) {
			this.reply = {
				type: "reply",
				id: 0,
				error: "入力中に文書が更新されました。編集内容を確認するか、編集を破棄して再読込してください。",
				notice: "",
				result: null,
				warnings: [],
			};
		}
	}
	/** 待機を取り直し、送信時点での最新版と下書きを使用する。 */
	private scheduleEdit() {
		this.connection.cancelEdit();
		if (!this.connection.connected || !this.state || this.active) {
			return;
		}
		const blocked =
			this.text === this.state.text ||
			isNonEmptyString(this.reply?.error);
		if (blocked) {
			return;
		}
		this.connection.scheduleEdit(() => {
			if (!this.state || this.active) {
				return;
			}
			const id = ++this.sequence;
			this.pending = { id, edit: true };
			this.active = true;
			this.bridge.postMessage({
				type: "edit",
				id,
				version: this.state.version,
				text: this.text,
			});
		});
	}
}
/** Getter を描画時に読み取り、分解代入で応答状態を固定しない。 */
export function useGuardrails(bridge: GuardBridge) {
	const editor = new GuardrailsEditorState(bridge);
	onMount(() => editor.connect());
	return editor;
}

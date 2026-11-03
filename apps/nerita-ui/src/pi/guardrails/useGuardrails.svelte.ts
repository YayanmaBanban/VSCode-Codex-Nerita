// 入力中の下書きを保持し、Host の文書版と要求番号で編集・保存を直列化する。
import { onMount } from "svelte";
import { isNonEmptyString } from "@nerita/shared/valuePredicates";
import { guardrailsFormSchema } from "./formSchema";
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
/** 画面ごとに未保存入力と要求状態を保持し、Host から受信した文書を下書きとの比較に使う。 */
class GuardrailsEditorState {
	state = $state.raw<GuardState | null>(null);
	text = $state("");
	reply = $state.raw<Extract<GuardReply, { type: "reply" }> | null>(null);
	private active = $state(false);
	private probeVersion = 0;
	private pending: {
		id: number;
		edit: boolean;
		probeVersion?: number;
		directory?: { index: number; version: number; text: string };
	} | null = null;
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
	/** 編集要求の応答待ちでは入力を許し、保存や検査の応答待ちでは固定する。 */
	get locked() {
		return this.active && this.pending?.edit === false;
	}
	/** Host 更新と未送信の入力が競合した場合に破棄操作を提示する。 */
	get conflict() {
		return Boolean(this.reply?.error) && this.text !== this.state?.text;
	}
	/** 購読を ready より先に登録し、再描画では再初期化しない。 */
	connect = () => this.connection.connect();
	/** 入力変更前の結果を消し、検査中ならその応答も現在の入力へ流用しない。 */
	invalidateProbe = () => {
		this.probeVersion++;
		if (this.reply?.result) {
			this.reply = null;
		}
	};
	/** 編集応答の待機中も上限内の入力を保持し、応答後に最新版を送る。 */
	change = (value: string) => {
		if (value.length > 131072) {
			this.reply = {
				type: "reply",
				id: 0,
				error: "設定は131072文字以内にしてください。",
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
	request = (type: "save" | "check" | "discard", probe: GuardProbe) => {
		if (!this.state || this.busy) {
			return;
		}
		const id = ++this.sequence;
		this.pending = {
			id,
			edit: false,
			...(type === "check" ? { probeVersion: this.probeVersion } : {}),
		};
		this.active = true;
		this.reply = null;
		this.bridge.postMessage(
			type === "check"
				? { type, id, version: this.state.version, probe }
				: { type, id, version: this.state.version },
		);
	};
	/** 同期済みの文書を固定して選択し、ダイアログ中はルールの移動や編集を止める。 */
	selectDirectory = (index: number) => {
		if (!this.state || this.busy) {
			return;
		}
		const id = ++this.sequence;
		this.pending = {
			id,
			edit: false,
			directory: { index, version: this.state.version, text: this.text },
		};
		this.active = true;
		this.reply = null;
		this.bridge.postMessage({
			type: "select-directory",
			id,
			version: this.state.version,
		});
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
		} else {
			this.receiveReply(message);
		}
		this.scheduleEdit();
	};
	/** 対応する要求の待機だけを解除し、条件変更前の検査応答を表示から除く。 */
	private receiveReply(message: Extract<GuardReply, { type: "reply" }>) {
		const pending = this.pending;
		if (pending?.id !== message.id) {
			return;
		}
		let showReply = !pending.edit || isNonEmptyString(message.error);
		if (pending.probeVersion !== undefined) {
			showReply = showReply && pending.probeVersion === this.probeVersion;
		}
		if (showReply) {
			this.reply = message;
		}
		this.pending = null;
		this.active = false;
		const directory = pending.directory;
		const selected = directory !== undefined && message.error === null;
		if (selected && typeof message.directory === "string") {
			this.applyDirectory(directory, message.directory);
		}
	}
	/** 選択中に外部更新があった場合は破棄し、選択開始時のルールだけへ相対パスを反映する。 */
	private applyDirectory(
		target: { index: number; version: number; text: string },
		directory: string,
	) {
		const changed =
			this.state?.version !== target.version || this.text !== target.text;
		if (changed) {
			return;
		}
		const parsed = guardrailsFormSchema.safeParse(JSON.parse(target.text));
		const rule = parsed.success
			? parsed.data.pathRules[target.index]
			: undefined;
		if (!parsed.success || rule?.match !== "directory") {
			return;
		}
		rule.directory = directory;
		this.change(`${JSON.stringify(parsed.data, null, 2)}\n`);
	}
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

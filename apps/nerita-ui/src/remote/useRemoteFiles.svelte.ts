// 現在の通常チャットに属するファイルプレビュー、変更一覧、Git 操作を管理する。
import type { RemoteChatState } from "@nerita/shared/remote/contracts";
import type {
	RemoteFilesReply,
	RemoteFilesRequest,
} from "@nerita/shared/remote/files";
import { RemoteResponseError, type RemoteTransport } from "./api";

/** 接続との情報の受け渡し。 */
type FileOptions = {
	getChat: () => RemoteChatState | undefined;
	getConnected: () => boolean;
	getTransport: () => RemoteTransport;
	getCsrf: () => string;
	notify: (message: string) => void;
};

/** ファイル操作から、送信前に採取する接続情報を除いた入力。 */
type FileOperation = {
	[Type in RemoteFilesRequest["type"]]: Omit<
		Extract<RemoteFilesRequest, { type: Type }>,
		"requestId" | "sessionId" | "backendGeneration"
	>;
}[RemoteFilesRequest["type"]];

/** ファイルの結果を受信した時点でも、取得元の会話と一致することを確認する。 */
export function useRemoteFiles(options: FileOptions) {
	return new RemoteFilesView(options);
}

/** ファイルの結果を受信した時点でも、取得元の会話と一致することを確認する。 */
class RemoteFilesView {
	/** 会話側から取得した接続をファイル操作に使う。 */
	constructor(private readonly options: FileOptions) {}

	private fileBusy = $state(false);

	changes = $state.raw<Extract<RemoteFilesReply, { type: "list" }>>();

	private file = $state.raw<Extract<RemoteFilesReply, { type: "file" }>>();

	/** Git 操作の完了後は、新しい変更一覧をすぐに取得する。 */
	files = async (operation: FileOperation) => {
		this.options.notify("");
		const refresh = await this.requestFiles(operation);
		if (refresh) {
			await this.requestFiles({ type: "list" });
		}
	};

	/** 同じ接続と会話へ返ったプレビューだけを表示する。 */
	private requestFiles = async (
		operation: FileOperation,
	): Promise<boolean> => {
		const current = this.options.getChat();
		const workspace = this.options.getTransport().workspace;
		const blocked = !this.options.getConnected() || this.fileBusy;
		if (blocked || workspace === undefined) {
			return false;
		}
		if (current === undefined || current.sessionId === null) {
			return false;
		}
		const target = {
			requestId: crypto.randomUUID(),
			sessionId: current.sessionId,
			backendGeneration: current.backendGeneration,
		};
		this.fileBusy = true;
		try {
			const reply = await workspace(
				{ ...operation, ...target },
				this.options.getCsrf(),
			);
			if (this.sameConversation(current)) {
				this.showFiles(reply, operation.type);
				return reply.type === "done";
			}
		} catch (error) {
			this.options.notify(
				error instanceof RemoteResponseError
					? error.message
					: "変更ファイルを確認できませんでした。",
			);
		} finally {
			this.fileBusy = false;
		}
		return false;
	};

	/** 接続や会話を切り替えた後に、遅着の結果を取り込まない。 */
	private sameConversation = (current: RemoteChatState) => {
		const chat = this.options.getChat();
		const sameHost =
			chat?.connectionGeneration === current.connectionGeneration;
		const sameSession = chat?.sessionId === current.sessionId;
		return (
			sameHost &&
			sameSession &&
			chat.backendGeneration === current.backendGeneration
		);
	};

	/** 現在のステージ済み変更に明示したメッセージを付ける。 */
	commitChanges = (message: string) => {
		const index = this.changes?.index;
		if (typeof index === "string" && message.trim().length > 0) {
			void this.files({ type: "commit", index, message });
		}
	};

	/** 一覧とファイルを表示し、Git 操作の完了後は古い一覧を取り下げる。 */
	private showFiles = (
		reply: RemoteFilesReply,
		operation: FileOperation["type"],
	) => {
		if (reply.type === "list") {
			this.changes = reply;
		} else if (reply.type === "file") {
			this.file = reply;
		} else {
			this.changes = undefined;
			const completed = {
				list: "",
				read: "",
				stage: "ステージしました。",
				commit: "コミットしました。",
				push: "プッシュしました。",
			};
			this.options.notify(completed[operation]);
		}
	};

	/** 確認した上流ブランチへコミット済みの変更を送る。 */
	confirmPush = () => {
		const target = this.changes?.push;
		if (!target) {
			return;
		}
		const message = `${target.destination} にコミット済みの変更をプッシュしますか？`;
		if (window.confirm(message)) {
			void this.files({ type: "push", ...target });
		}
	};

	/** 会話の変更や端末の解除に合わせて一覧とファイルを退避する。 */
	reset = () => {
		this.changes = undefined;
		this.file = undefined;
	};

	/** プレビューを閉じ、チャットに全幅を戻す。 */
	closePreview = () => {
		this.file = undefined;
	};

	/** ファイル操作の重複を防ぐガードを画面にも伝える。 */
	get busy() {
		return this.fileBusy;
	}
	/** 接続中の作業ツリーで表示しているテキスト。 */
	get preview() {
		return this.file;
	}
}
